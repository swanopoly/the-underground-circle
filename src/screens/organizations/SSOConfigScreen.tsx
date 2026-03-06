import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useOrg } from '../../hooks/useOrg';
import {
  getOrgSSOConfig,
  configureSSO,
  disableSSO,
  testSSOConnection,
  type SSOProvider,
} from '../../lib/sso';

export default function SSOConfigScreen({ route, navigation }: any) {
  const { orgId } = route.params;
  const { org, isOwner } = useOrg(orgId);
  const [config, setConfig] = useState<SSOProvider | null>(null);
  const [domain, setDomain] = useState('');
  const [metadataUrl, setMetadataUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [orgId]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await getOrgSSOConfig(orgId);
      if (data) {
        setConfig(data);
        setDomain(data.domain || '');
        setMetadataUrl(data.metadata_url || '');
      }
    } catch (err) {
      console.error('SSO config error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!domain.trim() || !metadataUrl.trim()) {
      const msg = 'Please fill in both domain and metadata URL';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Missing Fields', msg);
      return;
    }

    setSaving(true);
    const { error } = await configureSSO(orgId, {
      domain: domain.trim(),
      metadataUrl: metadataUrl.trim(),
    });
    setSaving(false);

    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    } else {
      const msg = 'SSO configured successfully';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Success', msg);
      loadConfig();
    }
  };

  const handleTest = async () => {
    if (!domain.trim()) return;
    setTesting(true);
    const result = await testSSOConnection(domain.trim());
    setTesting(false);

    if (result.success) {
      const msg = 'SSO connection test passed';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Success', msg);
    } else {
      const msg = result.error || 'Connection test failed';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Test Failed', msg);
    }
  };

  const handleDisable = async () => {
    const doDisable = async () => {
      const { error } = await disableSSO(orgId);
      if (error) {
        if (Platform.OS === 'web') alert(error);
        else Alert.alert('Error', error);
      } else {
        setConfig(null);
        setDomain('');
        setMetadataUrl('');
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Disable SSO? Members will need to use email/password login.')) doDisable();
    } else {
      Alert.alert('Disable SSO', 'Members will need to use email/password login.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disable', style: 'destructive', onPress: doDisable },
      ]);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#6366f1" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>SSO Configuration</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Status card */}
        <View style={[styles.statusCard, config?.is_active && styles.statusCardActive]}>
          <Text style={styles.statusIcon}>{config?.is_active ? '🔐' : '🔓'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusTitle, config?.is_active && { color: '#22c55e' }]}>
              {config?.is_active ? 'SSO Active' : 'SSO Not Configured'}
            </Text>
            {config?.is_active && (
              <Text style={styles.statusDomain}>{config.domain}</Text>
            )}
          </View>
          {config?.is_active && (
            <Pressable onPress={handleDisable} style={styles.disableBtn}>
              <Text style={styles.disableBtnText}>Disable</Text>
            </Pressable>
          )}
        </View>

        {/* Info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>SAML 2.0 Single Sign-On</Text>
          <Text style={styles.infoText}>
            Configure SSO to allow members to sign in with your organization's identity provider
            (Okta, Google Workspace, Azure AD, etc.).
          </Text>
        </View>

        {/* Configuration form */}
        <Text style={styles.sectionTitle}>Provider Settings</Text>

        <Text style={styles.label}>Email Domain</Text>
        <TextInput
          style={styles.input}
          value={domain}
          onChangeText={setDomain}
          placeholder="company.com"
          placeholderTextColor="#555"
          autoCapitalize="none"
          keyboardType="url"
        />

        <Text style={styles.label}>SAML Metadata URL</Text>
        <TextInput
          style={styles.input}
          value={metadataUrl}
          onChangeText={setMetadataUrl}
          placeholder="https://login.provider.com/metadata.xml"
          placeholderTextColor="#555"
          autoCapitalize="none"
          keyboardType="url"
        />

        <View style={styles.buttonRow}>
          <Pressable onPress={handleTest} style={styles.testBtn} disabled={testing || !domain}>
            <Text style={styles.testBtnText}>
              {testing ? 'Testing...' : 'Test Connection'}
            </Text>
          </Pressable>

          <Pressable onPress={handleSave} style={styles.saveBtn} disabled={saving}>
            <Text style={styles.saveBtnText}>
              {saving ? 'Saving...' : config?.is_active ? 'Update' : 'Enable SSO'}
            </Text>
          </Pressable>
        </View>

        {/* Setup guide */}
        <View style={styles.guideCard}>
          <Text style={styles.guideTitle}>Setup Guide</Text>
          <Text style={styles.guideStep}>1. Create a SAML app in your identity provider</Text>
          <Text style={styles.guideStep}>2. Set the ACS URL to your Supabase auth callback</Text>
          <Text style={styles.guideStep}>3. Copy the metadata URL from your provider</Text>
          <Text style={styles.guideStep}>4. Enter the domain and metadata URL above</Text>
          <Text style={styles.guideStep}>5. Click "Test Connection" to verify</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backBtn: { paddingRight: 12 },
  backText: { color: '#6366f1', fontSize: 14, fontFamily: 'monospace' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  content: { flex: 1, padding: 16 },
  statusCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  statusCardActive: { borderColor: '#22c55e40' },
  statusIcon: { fontSize: 24 },
  statusTitle: { color: '#888', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  statusDomain: { color: '#ccc', fontSize: 12, fontFamily: 'monospace' },
  disableBtn: {
    backgroundColor: '#ef444415',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  disableBtnText: { color: '#ef4444', fontSize: 12, fontFamily: 'monospace' },
  infoCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#6366f120',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  infoTitle: { color: '#6366f1', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 6 },
  infoText: { color: '#888', fontSize: 12, fontFamily: 'monospace', lineHeight: 18 },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 12 },
  label: { color: '#ccc', fontSize: 12, fontFamily: 'monospace', marginBottom: 6 },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 16,
  },
  buttonRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  testBtn: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  testBtnText: { color: '#ccc', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  saveBtn: {
    flex: 1,
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  guideCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
  },
  guideTitle: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'monospace', marginBottom: 10 },
  guideStep: { color: '#888', fontSize: 12, fontFamily: 'monospace', marginBottom: 6, lineHeight: 18 },
});
