import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { createOrganization, isSlugAvailable } from '../../lib/organizations';

export default function CreateOrgScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40);
  };

  const handleNameChange = (text: string) => {
    setName(text);
    if (!slugManual) {
      const newSlug = generateSlug(text);
      setSlug(newSlug);
      setSlugAvailable(null);
    }
  };

  const handleSlugChange = (text: string) => {
    setSlugManual(true);
    setSlug(generateSlug(text));
    setSlugAvailable(null);
  };

  const checkSlug = async () => {
    if (!slug || slug.length < 3) {
      setSlugAvailable(null);
      return;
    }
    const available = await isSlugAvailable(slug);
    setSlugAvailable(available);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Organization name is required');
      return;
    }
    if (!slug || slug.length < 3) {
      setError('Slug must be at least 3 characters');
      return;
    }

    setCreating(true);
    setError('');

    const { org, error: createError } = await createOrganization(name.trim(), slug);

    if (createError) {
      setError(createError);
      setCreating(false);
      return;
    }

    if (org) {
      navigation.replace('OrgDetail', { orgId: org.id, orgName: org.name });
    }
    setCreating(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Create Organization</Text>
      </View>

      <ScrollView style={styles.form} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.label}>Organization Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={handleNameChange}
          placeholder="e.g., Acme Corp"
          placeholderTextColor="#555"
          maxLength={50}
        />

        <Text style={styles.label}>URL Slug</Text>
        <View style={styles.slugRow}>
          <Text style={styles.slugPrefix}>underground.circle/</Text>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={slug}
            onChangeText={handleSlugChange}
            onBlur={checkSlug}
            placeholder="acme-corp"
            placeholderTextColor="#555"
            maxLength={40}
            autoCapitalize="none"
          />
        </View>
        {slugAvailable === true && (
          <Text style={styles.slugAvailable}>Available!</Text>
        )}
        {slugAvailable === false && (
          <Text style={styles.slugTaken}>Slug is already taken</Text>
        )}

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>What is an Organization?</Text>
          <Text style={styles.infoText}>
            Organizations let you manage multiple circles under one entity. Add team members, control billing, and unlock features like analytics, Slack integration, and more.
          </Text>
          <Text style={styles.infoText}>
            You'll start on the Free plan (1 circle, 8 members). Upgrade anytime to unlock more.
          </Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          onPress={handleCreate}
          style={[styles.createBtn, creating && styles.createBtnDisabled]}
          disabled={creating}
        >
          <Text style={styles.createBtnText}>
            {creating ? 'Creating...' : 'Create Organization'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
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
  form: { padding: 20 },
  label: { color: '#ccc', fontSize: 13, fontFamily: 'monospace', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    fontFamily: 'monospace',
  },
  slugRow: { flexDirection: 'row', alignItems: 'center' },
  slugPrefix: { color: '#555', fontSize: 13, fontFamily: 'monospace', marginRight: 4 },
  slugAvailable: { color: '#22c55e', fontSize: 12, fontFamily: 'monospace', marginTop: 4 },
  slugTaken: { color: '#ef4444', fontSize: 12, fontFamily: 'monospace', marginTop: 4 },
  infoBox: {
    backgroundColor: '#0d0d1a',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 10,
    padding: 16,
    marginTop: 24,
  },
  infoTitle: { color: '#6366f1', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  infoText: { color: '#888', fontSize: 12, fontFamily: 'monospace', lineHeight: 18, marginBottom: 6 },
  errorText: { color: '#ef4444', fontSize: 13, fontFamily: 'monospace', marginTop: 16, textAlign: 'center' },
  createBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 24,
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
});
