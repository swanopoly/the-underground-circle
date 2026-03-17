import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Platform,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getCircleInvites,
  createLinkInvite,
  createEmailInvite,
  revokeInvite,
  generateInviteUrl,
} from '../../lib/invites';
import { CircleInvite } from '../../types';

export default function InviteManageScreen({ route, navigation }: any) {
  const { circleId, circleName } = route.params;
  const [invites, setInvites] = useState<CircleInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadInvites();
    }, [circleId])
  );

  const loadInvites = async () => {
    setLoading(true);
    const data = await getCircleInvites(circleId);
    setInvites(data);
    setLoading(false);
  };

  const handleCreateLink = async () => {
    setCreating(true);
    const { invite, url, error } = await createLinkInvite(circleId, {
      maxUses: 0,
      expiresInDays: 7,
    });
    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    } else if (url) {
      // Copy to clipboard on web
      if (Platform.OS === 'web') {
        try {
          await navigator.clipboard.writeText(url);
          setCopiedId(invite?.id || null);
          setTimeout(() => setCopiedId(null), 2000);
        } catch {}
      }
      loadInvites();
    }
    setCreating(false);
  };

  const handleSendEmail = async () => {
    if (!emailInput.trim() || !emailInput.includes('@')) {
      if (Platform.OS === 'web') alert('Enter a valid email');
      else Alert.alert('Error', 'Enter a valid email');
      return;
    }

    setCreating(true);
    const { error } = await createEmailInvite(circleId, emailInput.trim());
    if (error) {
      if (Platform.OS === 'web') alert(error);
      else Alert.alert('Error', error);
    } else {
      setEmailInput('');
      setShowEmailForm(false);
      loadInvites();
    }
    setCreating(false);
  };

  const handleRevoke = async (inviteId: string) => {
    const doRevoke = async () => {
      await revokeInvite(inviteId);
      loadInvites();
    };

    if (Platform.OS === 'web') {
      if (confirm('Revoke this invite?')) doRevoke();
    } else {
      Alert.alert('Revoke Invite', 'This invite will no longer work.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: doRevoke },
      ]);
    }
  };

  const handleCopy = async (code: string) => {
    const url = generateInviteUrl(code);
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(url);
        setCopiedId(code);
        setTimeout(() => setCopiedId(null), 2000);
      } catch {}
    }
  };

  const pendingInvites = invites.filter(i => i.status === 'pending');
  const pastInvites = invites.filter(i => i.status !== 'pending');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Manage Invites</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Action buttons */}
        <View style={styles.actions}>
          <Pressable
            onPress={handleCreateLink}
            style={[styles.actionBtn, styles.linkBtn]}
            disabled={creating}
          >
            <Text style={styles.actionBtnText}>
              {creating ? 'Creating...' : '🔗 Create Link Invite'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setShowEmailForm(!showEmailForm)}
            style={[styles.actionBtn, styles.emailBtn]}
          >
            <Text style={styles.actionBtnText}>✉️ Invite by Email</Text>
          </Pressable>
        </View>

        {/* Email form */}
        {showEmailForm && (
          <View style={styles.emailForm}>
            <TextInput
              style={styles.emailInput}
              value={emailInput}
              onChangeText={setEmailInput}
              placeholder="email@example.com"
              placeholderTextColor="#555"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Pressable onPress={handleSendEmail} style={styles.sendBtn} disabled={creating}>
              <Text style={styles.sendBtnText}>{creating ? '...' : 'Send'}</Text>
            </Pressable>
          </View>
        )}

        {/* Pending invites */}
        <Text style={styles.sectionTitle}>Active Invites ({pendingInvites.length})</Text>
        {pendingInvites.map((invite) => (
          <View key={invite.id} style={styles.inviteCard}>
            <View style={styles.inviteHeader}>
              <Text style={styles.inviteType}>
                {invite.invite_type === 'link' ? '🔗 Link' : '✉️ Email'}
              </Text>
              <Text style={styles.inviteCode}>{invite.invite_code}</Text>
            </View>
            {invite.email && (
              <Text style={styles.inviteEmail}>{invite.email}</Text>
            )}
            <View style={styles.inviteMeta}>
              <Text style={styles.metaText}>
                Uses: {invite.use_count}/{invite.max_uses || '∞'}
              </Text>
              <Text style={styles.metaText}>
                Expires: {invite.expires_at
                  ? new Date(invite.expires_at).toLocaleDateString()
                  : 'Never'}
              </Text>
            </View>
            <View style={styles.inviteActions}>
              <Pressable
                onPress={() => handleCopy(invite.invite_code)}
                style={styles.copyBtn}
              >
                <Text style={styles.copyBtnText}>
                  {copiedId === invite.invite_code || copiedId === invite.id ? 'Copied!' : 'Copy Link'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => handleRevoke(invite.id)}
                style={styles.revokeBtn}
              >
                <Text style={styles.revokeBtnText}>Revoke</Text>
              </Pressable>
            </View>
          </View>
        ))}
        {pendingInvites.length === 0 && !loading && (
          <Text style={styles.emptyText}>No active invites. Create one above.</Text>
        )}

        {/* Past invites */}
        {pastInvites.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Past Invites ({pastInvites.length})</Text>
            {pastInvites.slice(0, 10).map((invite) => (
              <View key={invite.id} style={[styles.inviteCard, styles.inviteCardPast]}>
                <View style={styles.inviteHeader}>
                  <Text style={styles.inviteType}>
                    {invite.invite_type === 'link' ? '🔗' : '✉️'}
                    {' '}{invite.email || invite.invite_code}
                  </Text>
                  <View style={[styles.statusBadge, invite.status === 'accepted' && styles.statusAccepted, invite.status === 'revoked' && styles.statusRevoked, invite.status === 'expired' && styles.statusExpired]}>
                    <Text style={styles.statusText}>{invite.status.toUpperCase()}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
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
  content: { flex: 1, padding: 16 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  linkBtn: { backgroundColor: '#6366f1' + '15', borderColor: '#6366f1' + '40' },
  emailBtn: { backgroundColor: '#22c55e' + '15', borderColor: '#22c55e' + '40' },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  emailForm: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  emailInput: {
    flex: 1,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  sendBtn: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
  },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 10 },
  inviteCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  inviteCardPast: { opacity: 0.6 },
  inviteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inviteType: { color: '#ccc', fontSize: 13, fontFamily: 'monospace' },
  inviteCode: { color: '#6366f1', fontSize: 12, fontFamily: 'monospace' },
  inviteEmail: { color: '#888', fontSize: 12, fontFamily: 'monospace', marginTop: 4 },
  inviteMeta: { flexDirection: 'row', gap: 16, marginTop: 8 },
  metaText: { color: '#666', fontSize: 11, fontFamily: 'monospace' },
  inviteActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  copyBtn: {
    backgroundColor: '#6366f1' + '20',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  copyBtnText: { color: '#6366f1', fontSize: 12, fontFamily: 'monospace' },
  revokeBtn: {
    backgroundColor: '#ef4444' + '15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  revokeBtnText: { color: '#ef4444', fontSize: 12, fontFamily: 'monospace' },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#2a2a2a',
  },
  statusAccepted: { backgroundColor: '#22c55e' + '20' },
  statusRevoked: { backgroundColor: '#ef4444' + '20' },
  statusExpired: { backgroundColor: '#6b7280' + '20' },
  statusText: { color: '#ccc', fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  emptyText: { color: '#666', fontSize: 13, fontFamily: 'monospace', textAlign: 'center', paddingTop: 20 },
});
