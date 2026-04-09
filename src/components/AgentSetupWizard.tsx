/**
 * AgentSetupWizard.tsx
 *
 * 3-step modal for connecting an AI agent to the circle:
 *   Step 1 — Pick provider
 *   Step 2 — Enter endpoint + token, test connection
 *   Step 3 — Name agent, set gateway mode, publish
 */

import React, { useState, useCallback } from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, TextInput,
  ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AgentConnection, PROVIDER_META, ProviderType, generateId } from '../lib/connectionManager';
import { testConnection } from '../lib/openswanService';
import { DiagnosticResult, getTokenHint } from '../lib/connectionDiagnostics';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  onComplete: (conn: AgentConnection) => void;
}

type Step = 1 | 2 | 3;

interface ProviderCard {
  type: ProviderType;
  icon: string;
  label: string;
  tagline: string;
  color: string;
  defaultEndpoint: string;
}

const PROVIDERS: ProviderCard[] = [
  { type: 'openswan',      icon: '🐾', label: 'OpenSwan',    tagline: 'Recommended — full control',   color: '#6366f1', defaultEndpoint: 'http://localhost:18790' },
  { type: 'claude-code',   icon: '🤖', label: 'Claude Code', tagline: 'Anthropic\'s coding agent',     color: '#f97316', defaultEndpoint: 'http://localhost:8080'  },
  { type: 'codex',         icon: '🧠', label: 'Codex',       tagline: 'OpenAI\'s agent',               color: '#22c55e', defaultEndpoint: 'https://api.openai.com/v1' },
  { type: 'generic-agent', icon: '⚡', label: 'Other',       tagline: 'Any OpenAI-compatible API',    color: '#a855f7', defaultEndpoint: 'https://' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentSetupWizard({ visible, onClose, onComplete }: Props) {
  const [step, setStep]                   = useState<Step>(1);
  const [provider, setProvider]           = useState<ProviderCard>(PROVIDERS[0]);
  const [endpoint, setEndpoint]           = useState('http://localhost:18790');
  const [token, setToken]                 = useState('');
  const [agentName, setAgentName]         = useState('');
  const [testing, setTesting]             = useState(false);
  const [testResult, setTestResult]       = useState<{ ok: boolean; message: string; diagnostic?: DiagnosticResult } | null>(null);
  const [isPublic, setIsPublic]           = useState(false);
  const [publicUrl, setPublicUrl]         = useState('');
  const [copied, setCopied]               = useState<string | null>(null);

  const resetAndClose = useCallback(() => {
    setStep(1);
    setProvider(PROVIDERS[0]);
    setEndpoint('http://localhost:18790');
    setToken('');
    setAgentName('');
    setTesting(false);
    setTestResult(null);
    setIsPublic(false);
    setPublicUrl('');
    onClose();
  }, [onClose]);

  const pickProvider = useCallback((p: ProviderCard) => {
    setProvider(p);
    setEndpoint(p.defaultEndpoint);
    setAgentName(p.label);
    setTestResult(null);
    setStep(2);
  }, []);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testConnection({ endpoint, token });
    setTesting(false);
    if (result.ok) {
      const count = result.sessions?.length ?? 0;
      setTestResult({ ok: true, message: `Connected! Found ${count} session${count !== 1 ? 's' : ''}` });
    } else {
      setTestResult({ ok: false, message: result.error || 'Connection failed', diagnostic: result.diagnostic });
    }
  }, [endpoint, token]);

  const handleCopy = useCallback(async (text: string, key: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const handleFinish = useCallback(() => {
    const gatewayUrl = isPublic && publicUrl ? publicUrl : endpoint;
    const conn: AgentConnection = {
      id: generateId(),
      name: agentName || provider.label,
      provider: provider.type,
      endpoint,
      token,
      enabled: true,
      status: 'disconnected',
      color: provider.color,
    };
    onComplete(conn);
    resetAndClose();
  }, [agentName, provider, endpoint, token, isPublic, publicUrl, onComplete, resetAndClose]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={resetAndClose}>
      <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.stepDots}>
            {([1, 2, 3] as Step[]).map(n => (
              <View key={n} style={[s.dot, step >= n && s.dotActive]} />
            ))}
          </View>
          <Pressable onPress={resetAndClose} style={s.closeBtn}>
            <Text style={s.closeTxt}>✕</Text>
          </Pressable>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">

          {/* ── Step 1: Pick provider ── */}
          {step === 1 && (
            <View>
              <Text style={s.title}>Connect your AI agent</Text>
              <Text style={s.subtitle}>Choose what's running on your machine</Text>
              <View style={s.providerGrid}>
                {PROVIDERS.map(p => (
                  <Pressable key={p.type} style={s.providerCard} onPress={() => pickProvider(p)}>
                    <Text style={s.providerIcon}>{p.icon}</Text>
                    <Text style={s.providerLabel}>{p.label}</Text>
                    <Text style={s.providerTagline}>{p.tagline}</Text>
                    <View style={[s.providerBar, { backgroundColor: p.color }]} />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* ── Step 2: Connect ── */}
          {step === 2 && (
            <View>
              <Text style={s.title}>Connect {provider.label}</Text>
              <Text style={s.subtitle}>Enter your gateway details</Text>

              <Text style={s.label}>Endpoint</Text>
              <TextInput
                style={s.input}
                value={endpoint}
                onChangeText={t => { setEndpoint(t); setTestResult(null); }}
                placeholder="http://localhost:18790"
                placeholderTextColor="#3e3e3e"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={s.label}>Auth Token</Text>
              <TextInput
                style={s.input}
                value={token}
                onChangeText={t => { setToken(t); setTestResult(null); }}
                placeholder="your-gateway-token"
                placeholderTextColor="#3e3e3e"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />

              {/* Token hint */}
              <View style={s.hintBox}>
                <Text style={s.hintTitle}>📋 Where to find your token</Text>
                <View style={s.hintCmd}>
                  <Text style={s.hintCmdText}>{getTokenHint()}</Text>
                  <Pressable style={s.copyBtn} onPress={() => handleCopy(getTokenHint(), 'token')}>
                    <Text style={s.copyBtnTxt}>{copied === 'token' ? '✓ Copied' : 'Copy'}</Text>
                  </Pressable>
                </View>
              </View>

              {/* Test button */}
              <Pressable
                style={[s.primaryBtn, testing && s.primaryBtnDisabled]}
                onPress={handleTest}
                disabled={testing || !endpoint}
              >
                {testing
                  ? <><ActivityIndicator size="small" color="#ffffff" /><Text style={s.primaryBtnTxt}> Testing...</Text></>
                  : <Text style={s.primaryBtnTxt}>Test Connection</Text>
                }
              </Pressable>

              {/* Test result */}
              {testResult && (
                <View style={[s.resultBox, testResult.ok ? s.resultOk : s.resultErr]}>
                  <Text style={[s.resultTxt, testResult.ok ? s.resultTxtOk : s.resultTxtErr]}>
                    {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
                  </Text>
                  {!testResult.ok && testResult.diagnostic && (
                    <View style={s.diagFix}>
                      <Text style={s.diagFixLabel}>{testResult.diagnostic.fix}</Text>
                      {testResult.diagnostic.fixAction === 'copy_command' && testResult.diagnostic.fixValue && (
                        <View style={s.hintCmd}>
                          <Text style={s.hintCmdText}>{testResult.diagnostic.fixValue}</Text>
                          <Pressable style={s.copyBtn} onPress={() => handleCopy(testResult.diagnostic!.fixValue!, 'fix')}>
                            <Text style={s.copyBtnTxt}>{copied === 'fix' ? '✓ Copied' : 'Copy'}</Text>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}

              {/* Nav */}
              <View style={s.navRow}>
                <Pressable style={s.backBtn} onPress={() => setStep(1)}>
                  <Text style={s.backBtnTxt}>← Back</Text>
                </Pressable>
                <Pressable
                  style={[s.primaryBtn, s.navNext, (!testResult?.ok) && s.primaryBtnDisabled]}
                  onPress={() => setStep(3)}
                  disabled={!testResult?.ok}
                >
                  <Text style={s.primaryBtnTxt}>Continue →</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ── Step 3: Publish ── */}
          {step === 3 && (
            <View>
              <Text style={s.title}>You're connected 🎉</Text>
              <Text style={s.subtitle}>Customize how you appear in the circle</Text>

              {/* Agent summary card */}
              <View style={s.summaryCard}>
                <Text style={s.summaryIcon}>{provider.icon}</Text>
                <View style={s.summaryInfo}>
                  <Text style={s.summaryProvider}>{provider.label}</Text>
                  <Text style={s.summaryEndpoint}>{endpoint}</Text>
                </View>
                <View style={[s.summaryDot, { backgroundColor: '#22c55e' }]} />
              </View>

              <Text style={s.label}>Agent name</Text>
              <TextInput
                style={s.input}
                value={agentName}
                onChangeText={setAgentName}
                placeholder={provider.label}
                placeholderTextColor="#3e3e3e"
                autoCorrect={false}
              />

              {/* Gateway mode */}
              <Text style={s.label}>Availability</Text>
              <Pressable style={[s.modeCard, !isPublic && s.modeCardActive]} onPress={() => setIsPublic(false)}>
                <Text style={s.modeIcon}>🏠</Text>
                <View style={s.modeInfo}>
                  <Text style={s.modeTitle}>Local only</Text>
                  <Text style={s.modeSub}>Circle sees your status — commands stay on your machine</Text>
                </View>
                <View style={[s.radio, !isPublic && s.radioActive]} />
              </Pressable>
              <Pressable style={[s.modeCard, isPublic && s.modeCardActive]} onPress={() => setIsPublic(true)}>
                <Text style={s.modeIcon}>🌐</Text>
                <View style={s.modeInfo}>
                  <Text style={s.modeTitle}>Public URL</Text>
                  <Text style={s.modeSub}>Circle members can send you commands cross-machine</Text>
                </View>
                <View style={[s.radio, isPublic && s.radioActive]} />
              </Pressable>

              {isPublic && (
                <>
                  <TextInput
                    style={[s.input, { marginTop: 8 }]}
                    value={publicUrl}
                    onChangeText={setPublicUrl}
                    placeholder="https://your-tunnel.trycloudflare.com"
                    placeholderTextColor="#3e3e3e"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={s.hintBox}>
                    <Text style={s.hintTitle}>🔧 Quick tunnel setup</Text>
                    <View style={s.hintCmd}>
                      <Text style={s.hintCmdText}>cloudflared tunnel --url http://localhost:18790</Text>
                      <Pressable style={s.copyBtn} onPress={() => handleCopy('cloudflared tunnel --url http://localhost:18790', 'tunnel')}>
                        <Text style={s.copyBtnTxt}>{copied === 'tunnel' ? '✓ Copied' : 'Copy'}</Text>
                      </Pressable>
                    </View>
                  </View>
                </>
              )}

              {/* Nav */}
              <View style={s.navRow}>
                <Pressable style={s.backBtn} onPress={() => setStep(2)}>
                  <Text style={s.backBtnTxt}>← Back</Text>
                </Pressable>
                <Pressable style={s.primaryBtn} onPress={handleFinish}>
                  <Text style={s.primaryBtnTxt}>Finish & Publish 🚀</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#000000' },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 20, paddingHorizontal: 20, paddingBottom: 8 },
  stepDots:      { flexDirection: 'row', gap: 8, flex: 1, justifyContent: 'center' },
  dot:           { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a2a2a' },
  dotActive:     { backgroundColor: '#6366f1' },
  closeBtn:      { position: 'absolute', right: 20, top: 20, padding: 4 },
  closeTxt:      { color: '#6f6f6f', fontSize: 18 },
  scroll:        { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 60 },
  title:         { color: '#e8e8e8', fontSize: 24, fontWeight: '700', marginBottom: 6 },
  subtitle:      { color: '#6f6f6f', fontSize: 14, marginBottom: 28 },
  label:         { color: '#9e9e9e', fontSize: 12, fontWeight: '600', marginBottom: 8, marginTop: 16, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:         { backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 10, padding: 14, color: '#e8e8e8', fontSize: 14 },

  // Provider grid
  providerGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  providerCard:   { width: '47%', backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 14, padding: 16, gap: 4, overflow: 'hidden' },
  providerIcon:   { fontSize: 28, marginBottom: 4 },
  providerLabel:  { color: '#e8e8e8', fontSize: 15, fontWeight: '700' },
  providerTagline:{ color: '#6f6f6f', fontSize: 12, lineHeight: 16 },
  providerBar:    { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, opacity: 0.6 },

  // Hint box
  hintBox:     { backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 10, padding: 12, marginTop: 12 },
  hintTitle:   { color: '#9e9e9e', fontSize: 12, marginBottom: 8 },
  hintCmd:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#000000', borderRadius: 6, padding: 8 },
  hintCmdText: { color: '#e8e8e8', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', flex: 1 },
  copyBtn:     { backgroundColor: '#252525', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#6366f130' },
  copyBtnTxt:  { color: '#b5b5b5', fontSize: 11, fontWeight: '600' },

  // Buttons
  primaryBtn:        { backgroundColor: '#6366f1', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 16, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  primaryBtnDisabled:{ opacity: 0.4 },
  primaryBtnTxt:     { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  backBtn:           { paddingVertical: 14, paddingHorizontal: 4 },
  backBtnTxt:        { color: '#6f6f6f', fontSize: 14 },
  navRow:            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  navNext:           { flex: 0, paddingHorizontal: 24, marginTop: 0 },

  // Test result
  resultBox:    { borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1 },
  resultOk:     { backgroundColor: '#22c55e10', borderColor: '#22c55e40' },
  resultErr:    { backgroundColor: '#ef444410', borderColor: '#ef444440' },
  resultTxt:    { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  resultTxtOk:  { color: '#22c55e' },
  resultTxtErr: { color: '#ef4444' },
  diagFix:      { marginTop: 8 },
  diagFixLabel: { color: '#9e9e9e', fontSize: 12, marginBottom: 6 },

  // Summary card
  summaryCard:     { backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  summaryIcon:     { fontSize: 28 },
  summaryInfo:     { flex: 1 },
  summaryProvider: { color: '#e8e8e8', fontSize: 15, fontWeight: '700' },
  summaryEndpoint: { color: '#6f6f6f', fontSize: 11, marginTop: 2 },
  summaryDot:      { width: 10, height: 10, borderRadius: 5 },

  // Mode cards
  modeCard:      { backgroundColor: '#161616', borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  modeCardActive:{ borderColor: '#6366f1', backgroundColor: '#6366f108' },
  modeIcon:      { fontSize: 22 },
  modeInfo:      { flex: 1 },
  modeTitle:     { color: '#e8e8e8', fontSize: 14, fontWeight: '600' },
  modeSub:       { color: '#6f6f6f', fontSize: 12, marginTop: 2, lineHeight: 16 },
  radio:         { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#3e3e3e' },
  radioActive:   { borderColor: '#6366f1', backgroundColor: '#6366f1' },
});
