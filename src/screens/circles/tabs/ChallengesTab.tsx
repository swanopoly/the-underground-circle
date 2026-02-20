import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  RefreshControl,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { showAlert } from '../../../lib/alert';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import PeakHoursIndicator from '../../../components/PeakHoursIndicator';
import type { Challenge, ChallengeParticipant } from '../../../types';

const TYPE_ICONS: Record<string, string> = {
  streak: '🔥',
  checkins: '✅',
  tasks: '📋',
  xp: '⚡',
};

const TYPE_LABELS: Record<string, string> = {
  streak: 'STREAK',
  checkins: 'CHECK-INS',
  tasks: 'TASKS',
  xp: 'XP',
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function daysRemaining(endDate: string): number {
  const end = new Date(endDate + 'T23:59:59');
  const now = new Date();
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
}

export default function ChallengesTab({ circleId }: { circleId: string }) {
  const [challenges, setChallenges] = useState<any[]>([]);
  const [participants, setParticipants] = useState<Record<string, ChallengeParticipant[]>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const fetchChallenges = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    const { data, error } = await supabase
      .from('challenges')
      .select('*')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching challenges:', error);
      return;
    }

    setChallenges(data || []);

    // Fetch participants for all challenges
    const ids = (data || []).map((c: any) => c.id);
    if (ids.length > 0) {
      const { data: parts } = await supabase
        .from('challenge_participants')
        .select('*, user:profiles(username, display_name)')
        .in('challenge_id', ids)
        .limit(50);

      const grouped: Record<string, ChallengeParticipant[]> = {};
      for (const p of parts || []) {
        if (!grouped[p.challenge_id]) grouped[p.challenge_id] = [];
        grouped[p.challenge_id].push(p);
      }
      setParticipants(grouped);
    }
  }, [circleId]);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  const joinChallenge = async (challengeId: string) => {
    if (!currentUserId) return;
    const { error } = await supabase.from('challenge_participants').insert({
      challenge_id: challengeId,
      user_id: currentUserId,
    });
    if (error) {
      if (error.code === '23505') {
        showAlert('Already Joined', "You're already in this challenge.");
      } else {
        showAlert('Error', error.message);
      }
      return;
    }
    fetchChallenges();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchChallenges();
    setRefreshing(false);
  };

  const active = challenges.filter((c) => c.status === 'active');
  const completed = challenges.filter((c) => c.status === 'completed');

  const isJoined = (challengeId: string) => {
    return (participants[challengeId] || []).some((p) => p.user_id === currentUserId);
  };

  const myProgress = (challengeId: string) => {
    return (participants[challengeId] || []).find((p) => p.user_id === currentUserId);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={[...active, ...completed]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
        ListHeaderComponent={
          <View>
            <PeakHoursIndicator style={styles.peakHoursIndicator} />
            {active.length > 0 && (
              <Text style={styles.sectionLabel}>ACTIVE CHALLENGES</Text>
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          const isCompleted = item.status === 'completed';
          const parts = participants[item.id] || [];
          const progress = myProgress(item.id);
          const days = daysRemaining(item.end_date);
          const joined = isJoined(item.id);

          // Show completed section header
          const showCompletedHeader =
            isCompleted && index === active.length;

          return (
            <View>
              {showCompletedHeader && (
                <Text style={[styles.sectionLabel, { marginTop: 20 }]}>COMPLETED</Text>
              )}
              <Card style={[styles.challengeCard, isCompleted && styles.challengeCardCompleted]}>
                <View style={styles.challengeHeader}>
                  <Text style={styles.typeIcon}>{TYPE_ICONS[item.challenge_type] || '🎯'}</Text>
                  <View style={styles.challengeInfo}>
                    <Text style={[styles.challengeTitle, isCompleted && styles.challengeTitleDone]}>
                      {item.title}
                    </Text>
                    <Text style={styles.challengeType}>{TYPE_LABELS[item.challenge_type]}</Text>
                  </View>
                  <View style={styles.challengeMeta}>
                    <Text style={styles.xpReward}>+{formatNumber(item.xp_reward)} XP</Text>
                    {!isCompleted && (
                      <Text style={styles.daysLeft}>{days}d left</Text>
                    )}
                  </View>
                </View>

                {item.description && (
                  <Text style={styles.challengeDesc}>{item.description}</Text>
                )}

                {/* Progress bar */}
                {joined && progress && (
                  <View style={styles.progressContainer}>
                    <View style={styles.progressBar}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${Math.min(100, (progress.progress / item.target_value) * 100)}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.progressText}>
                      {formatNumber(progress.progress)}/{formatNumber(item.target_value)}
                    </Text>
                  </View>
                )}

                <View style={styles.challengeFooter}>
                  <Text style={styles.participantCount}>
                    {parts.length} participant{parts.length !== 1 ? 's' : ''}
                  </Text>
                  {!isCompleted && !joined && (
                    <Pressable
                      onPress={() => joinChallenge(item.id)}
                      style={styles.joinButton}
                    >
                      <Text style={styles.joinButtonText}>JOIN</Text>
                    </Pressable>
                  )}
                  {joined && progress?.completed && (
                    <Text style={styles.completedBadge}>✓ COMPLETED</Text>
                  )}
                </View>

                {/* Winners for completed */}
                {isCompleted && parts.filter((p: any) => p.completed).length > 0 && (
                  <View style={styles.winnersSection}>
                    <Text style={styles.winnersLabel}>WINNERS</Text>
                    {parts
                      .filter((p: any) => p.completed)
                      .map((p: any, i: number) => (
                        <Text key={i} style={styles.winnerName}>
                          🏆 {(p as any).user?.display_name || (p as any).user?.username || 'Unknown'}
                        </Text>
                      ))}
                  </View>
                )}
              </Card>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🎯</Text>
            <Text style={styles.emptyText}>No challenges yet</Text>
            <Text style={styles.emptySubtext}>Create one and rally your circle</Text>
          </View>
        }
      />

      <View style={styles.createBar}>
        <Button title="+ CREATE CHALLENGE" onPress={() => setShowCreate(true)} />
      </View>

      {showCreate && (
        <CreateChallengeModal
          circleId={circleId}
          currentUserId={currentUserId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchChallenges(); }}
        />
      )}
    </View>
  );
}

function CreateChallengeModal({
  circleId,
  currentUserId,
  onClose,
  onCreated,
}: {
  circleId: string;
  currentUserId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [challengeType, setChallengeType] = useState<string>('checkins');
  const [targetValue, setTargetValue] = useState('7');
  const [xpReward, setXpReward] = useState('100');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    if (!title.trim()) { setError('Give the challenge a title'); return; }
    if (!currentUserId) { setError('Not logged in'); return; }

    const target = parseInt(targetValue, 10);
    const reward = parseInt(xpReward, 10);
    if (isNaN(target) || target < 1) { setError('Invalid target value'); return; }
    if (isNaN(reward) || reward < 1) { setError('Invalid XP reward'); return; }

    setLoading(true);
    const startDate = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const { error: createError } = await supabase.from('challenges').insert({
      circle_id: circleId,
      title: title.trim(),
      description: description.trim() || null,
      challenge_type: challengeType,
      target_value: target,
      start_date: startDate,
      end_date: endDate,
      created_by: currentUserId,
      xp_reward: reward,
    });

    setLoading(false);
    if (createError) { setError(createError.message); return; }
    onCreated();
  };

  return (
    <View style={styles.modalOverlay}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>NEW CHALLENGE</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.inputLabel}>TITLE</Text>
        <TextInput
          style={styles.input}
          placeholder="Challenge name..."
          placeholderTextColor="#444"
          value={title}
          onChangeText={setTitle}
          maxLength={100}
        />

        <Text style={styles.inputLabel}>DESCRIPTION (OPTIONAL)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="What's the challenge about?"
          placeholderTextColor="#444"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={300}
        />

        <Text style={styles.inputLabel}>TYPE</Text>
        <View style={styles.typeRow}>
          {(['streak', 'checkins', 'tasks', 'xp'] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setChallengeType(t)}
              style={[styles.typeChip, challengeType === t && styles.typeChipActive]}
            >
              <Text style={[styles.typeChipText, challengeType === t && styles.typeChipTextActive]}>
                {TYPE_ICONS[t]} {TYPE_LABELS[t]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.inputLabel}>TARGET VALUE</Text>
        <TextInput
          style={styles.input}
          placeholder="7"
          placeholderTextColor="#444"
          value={targetValue}
          onChangeText={setTargetValue}
          keyboardType="numeric"
          maxLength={6}
        />

        <Text style={styles.inputLabel}>XP REWARD</Text>
        <TextInput
          style={styles.input}
          placeholder="100"
          placeholderTextColor="#444"
          value={xpReward}
          onChangeText={setXpReward}
          keyboardType="numeric"
          maxLength={6}
        />

        <View style={styles.modalButtons}>
          <Button title="CREATE CHALLENGE" onPress={handleCreate} loading={loading} />
          <Button title="CANCEL" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: {
    padding: 16,
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
  },
  peakHoursIndicator: {
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#666',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 10,
  },
  challengeCard: { marginBottom: 8 },
  challengeCardCompleted: { opacity: 0.6 },
  challengeHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  typeIcon: { fontSize: 24 },
  challengeInfo: { flex: 1 },
  challengeTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  challengeTitleDone: { color: '#666', textDecorationLine: 'line-through' },
  challengeType: { color: '#555', fontSize: 10, letterSpacing: 1, fontWeight: '700', marginTop: 2 },
  challengeMeta: { alignItems: 'flex-end' as const },
  xpReward: { color: '#e89b3e', fontSize: 12, fontWeight: '800' },
  daysLeft: { color: '#555', fontSize: 10, marginTop: 2 },
  challengeDesc: { color: '#888', fontSize: 13, marginTop: 8, lineHeight: 18 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#222',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4a9a4a',
    borderRadius: 3,
  },
  progressText: { color: '#888', fontSize: 12, fontWeight: '700' },
  challengeFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  participantCount: { color: '#555', fontSize: 11, fontWeight: '600' },
  joinButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  joinButtonText: { color: '#0a0a0a', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  completedBadge: { color: '#4a9a4a', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  winnersSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#222' },
  winnersLabel: { color: '#666', fontSize: 10, letterSpacing: 1, fontWeight: '700', marginBottom: 4 },
  winnerName: { color: '#e89b3e', fontSize: 13, fontWeight: '600', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 32, marginBottom: 12 },
  emptyText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptySubtext: { color: '#555', fontSize: 14, marginTop: 4 },
  createBar: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
  },
  // Modal
  modalOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalCard: {
    width: '90%',
    maxWidth: 700,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: '#222',
    zIndex: 101,
    maxHeight: '85%',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 24,
  },
  inputLabel: { color: '#666', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  errorBox: { backgroundColor: '#2a1515', borderWidth: 1, borderColor: '#4a2020', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff6666', fontSize: 13, textAlign: 'center' },
  typeRow: { flexDirection: 'row', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  typeChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    backgroundColor: '#0a0a0a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  typeChipActive: { borderColor: '#fff', backgroundColor: '#1a1a1a' },
  typeChipText: { color: '#555', fontSize: 11, fontWeight: '700' },
  typeChipTextActive: { color: '#fff' },
  modalButtons: { gap: 8, marginTop: 8 },
});
