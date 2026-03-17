import React, { useState, useEffect } from 'react';
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
import { useOrg } from '../../hooks/useOrg';
import { updateOrganization, deleteOrganization } from '../../lib/organizations';

export default function OrgSettingsScreen({ route, navigation }: any) {
  const { orgId } = route.params;
  const { org, isOwner, loading } = useOrg(orgId);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (org) setName(org.name);
  }, [org]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    const { error: saveError } = await updateOrganization(orgId, { name: name.trim() });
    if (saveError) setError(saveError);
    setSaving(false);
  };

  const handleDelete = async () => {
    const doDelete = async () => {
      const { error: delError } = await deleteOrganization(orgId);
      if (delError) {
        if (Platform.OS === 'web') alert(delError);
        else Alert.alert('Error', delError);
      } else {
        navigation.popToTop();
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Delete this organization? Circles will be unlinked but not deleted.')) doDelete();
    } else {
      Alert.alert(
        'Delete Organization',
        'Circles will be unlinked but not deleted. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Organization Settings</Text>
      </View>

      <ScrollView style={styles.form} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.label}>Organization Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholderTextColor="#555"
          maxLength={50}
        />

        <Text style={styles.label}>Slug</Text>
        <Text style={styles.slugReadonly}>/{org?.slug}</Text>
        <Text style={styles.hint}>Slug cannot be changed after creation.</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          onPress={handleSave}
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          disabled={saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </Pressable>

        {isOwner && (
          <View style={styles.dangerZone}>
            <Text style={styles.dangerTitle}>Danger Zone</Text>
            <Text style={styles.dangerText}>
              Deleting the organization will unlink all circles (they won't be deleted). This action cannot be undone.
            </Text>
            <Pressable onPress={handleDelete} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>Delete Organization</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
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
  form: { padding: 20 },
  label: { color: '#ccc', fontSize: 13, fontFamily: 'monospace', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    fontFamily: 'monospace',
  },
  slugReadonly: { color: '#888', fontSize: 15, fontFamily: 'monospace', padding: 12 },
  hint: { color: '#555', fontSize: 11, fontFamily: 'monospace' },
  errorText: { color: '#ef4444', fontSize: 13, fontFamily: 'monospace', marginTop: 12 },
  saveBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  dangerZone: {
    marginTop: 48,
    borderWidth: 1,
    borderColor: '#ef4444' + '40',
    borderRadius: 12,
    padding: 20,
    backgroundColor: '#ef4444' + '08',
  },
  dangerTitle: { color: '#ef4444', fontSize: 15, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  dangerText: { color: '#888', fontSize: 12, fontFamily: 'monospace', lineHeight: 18, marginBottom: 16 },
  deleteBtn: {
    backgroundColor: '#ef4444',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
});
