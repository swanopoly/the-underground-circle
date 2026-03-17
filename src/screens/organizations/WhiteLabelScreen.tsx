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
  getWhiteLabelConfig,
  updateWhiteLabelConfig,
  resetToDefaults,
  DEFAULT_BRANDING,
} from '../../lib/whitelabel';
import type { WhiteLabelConfig } from '../../types';

const COLOR_FIELDS = [
  { key: 'primary_color', label: 'Primary Color', default: '#6366f1' },
  { key: 'accent_color', label: 'Accent Color', default: '#22c55e' },
  { key: 'background_color', label: 'Background', default: '#000000' },
  { key: 'card_color', label: 'Card Background', default: '#111111' },
  { key: 'border_color', label: 'Border Color', default: '#2a2a2a' },
  { key: 'text_color', label: 'Text Color', default: '#ffffff' },
] as const;

export default function WhiteLabelScreen({ route, navigation }: any) {
  const { orgId } = route.params;
  const { isOwner } = useOrg(orgId);
  const [config, setConfig] = useState<Partial<WhiteLabelConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [orgId]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await getWhiteLabelConfig(orgId);
      setConfig(data || { ...DEFAULT_BRANDING });
    } catch (err) {
      console.error('White-label load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateField = (key: string, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await updateWhiteLabelConfig(orgId, config);
    setSaving(false);

    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    } else {
      const msg = 'Branding updated successfully';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Saved', msg);
    }
  };

  const handleReset = async () => {
    const doReset = async () => {
      setSaving(true);
      const { error } = await resetToDefaults(orgId);
      setSaving(false);

      if (error) {
        if (Platform.OS === 'web') alert(error);
        else Alert.alert('Error', error);
      } else {
        setConfig({ ...DEFAULT_BRANDING });
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Reset all branding to defaults?')) doReset();
    } else {
      Alert.alert('Reset Branding', 'This will restore all default colors and settings.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: doReset },
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

  const previewPrimary = config.primary_color || '#6366f1';
  const previewBg = config.background_color || '#000000';
  const previewCard = config.card_color || '#111111';
  const previewBorder = config.border_color || '#2a2a2a';
  const previewText = config.text_color || '#ffffff';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>White-Label</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Live Preview */}
        <Text style={styles.sectionTitle}>Live Preview</Text>
        <View style={[styles.previewContainer, { backgroundColor: previewBg }]}>
          <View style={[styles.previewCard, { backgroundColor: previewCard, borderColor: previewBorder }]}>
            <Text style={[styles.previewAppName, { color: previewPrimary }]}>
              {config.app_name || 'The Underground Circle'}
            </Text>
            <Text style={[styles.previewText, { color: previewText }]}>
              Welcome back! Your circle is active.
            </Text>
            <View style={[styles.previewBtn, { backgroundColor: previewPrimary }]}>
              <Text style={styles.previewBtnText}>Check In</Text>
            </View>
          </View>
        </View>

        {/* App name */}
        <Text style={styles.sectionTitle}>General</Text>
        <Text style={styles.label}>App Name</Text>
        <TextInput
          style={styles.input}
          value={config.app_name || ''}
          onChangeText={v => updateField('app_name', v)}
          placeholder="The Underground Circle"
          placeholderTextColor="#555"
        />

        <Text style={styles.label}>Logo URL</Text>
        <TextInput
          style={styles.input}
          value={config.logo_url || ''}
          onChangeText={v => updateField('logo_url', v)}
          placeholder="https://..."
          placeholderTextColor="#555"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Login Message</Text>
        <TextInput
          style={styles.input}
          value={config.login_message || ''}
          onChangeText={v => updateField('login_message', v)}
          placeholder="Custom welcome message"
          placeholderTextColor="#555"
        />

        {/* Colors */}
        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Colors</Text>
        {COLOR_FIELDS.map(field => (
          <View key={field.key} style={styles.colorRow}>
            <View style={[styles.colorSwatch, { backgroundColor: (config as any)[field.key] || field.default }]} />
            <Text style={styles.colorLabel}>{field.label}</Text>
            <TextInput
              style={styles.colorInput}
              value={(config as any)[field.key] || field.default}
              onChangeText={v => updateField(field.key, v)}
              placeholder={field.default}
              placeholderTextColor="#555"
              autoCapitalize="none"
            />
          </View>
        ))}

        {/* Domain */}
        <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Advanced</Text>
        <Text style={styles.label}>Custom Domain</Text>
        <TextInput
          style={styles.input}
          value={config.custom_domain || ''}
          onChangeText={v => updateField('custom_domain', v)}
          placeholder="app.yourcompany.com"
          placeholderTextColor="#555"
          autoCapitalize="none"
        />

        <Pressable
          onPress={() => updateField('hide_branding', !config.hide_branding)}
          style={styles.toggleRow}
        >
          <Text style={styles.toggleLabel}>Hide "Powered by" branding</Text>
          <View style={[styles.toggleDot, config.hide_branding && styles.toggleDotActive]} />
        </Pressable>

        {/* Actions */}
        <View style={styles.actionRow}>
          <Pressable onPress={handleReset} style={styles.resetBtn}>
            <Text style={styles.resetBtnText}>Reset Defaults</Text>
          </Pressable>
          <Pressable onPress={handleSave} style={styles.saveBtn} disabled={saving}>
            <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backBtn: { paddingRight: 12 },
  backText: { color: '#6366f1', fontSize: 14, fontFamily: 'monospace' },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace' },
  content: { flex: 1, padding: 16 },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 10 },
  label: { color: '#ccc', fontSize: 12, fontFamily: 'monospace', marginBottom: 6 },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
    marginBottom: 14,
  },
  previewContainer: {
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  previewCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  previewAppName: { fontSize: 16, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  previewText: { fontSize: 12, fontFamily: 'monospace', marginBottom: 12 },
  previewBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  previewBtnText: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  colorLabel: { flex: 1, color: '#ccc', fontSize: 12, fontFamily: 'monospace' },
  colorInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#fff',
    fontSize: 12,
    fontFamily: 'monospace',
    width: 100,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  toggleLabel: { color: '#ccc', fontSize: 13, fontFamily: 'monospace' },
  toggleDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#555',
  },
  toggleDotActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  resetBtn: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  resetBtnText: { color: '#ccc', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  saveBtn: {
    flex: 1,
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
});
