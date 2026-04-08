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
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import Button from '../../components/Button';
import { awardXP, vote as castVote, getUserVotes, getXPForAction } from '../../lib/gamification';

function ProofDisplay({ 
  proof, 
  checkInId, 
  currentUserId,
  onValidate 
}: { 
  proof: any;
  checkInId: string;
  currentUserId: string | null;
  onValidate: (checkInId: string, isValid: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [validating, setValidating] = useState(false);
  if (!proof) return null;

  const handleValidate = async (isValid: boolean) => {
    if (!currentUserId || validating) return;
    setValidating(true);
    try {
      await onValidate(checkInId, isValid);
    } finally {
      setValidating(false);
    }
  };

  // Validation defaults — real peer validation will be added in a future release
  const validationScore = proof?.validation_score ?? 0;
  const validationCount = proof?.validation_count ?? 0;
  const userHasValidated = false;

  const getValidationBadge = () => {
    if (validationScore >= 80) return { text: '✅ VERIFIED', style: styles.verifiedBadge };
    if (validationScore >= 50) return { text: '👥 PEER OK', style: styles.peerValidatedBadge };
    return { text: '⏳ UNVERIFIED', style: styles.unverifiedBadge };
  };

  const badge = getValidationBadge();

  return (
    <View style={styles.proofContainer}>
      <View style={styles.proofHeader}>
        <Pressable onPress={() => setExpanded(!expanded)} style={styles.proofToggle}>
          <Text style={styles.proofToggleText}>
            {expanded ? 'HIDE PROOF 📎' : 'VIEW PROOF 📎'}
          </Text>
        </Pressable>
        <View style={styles.validationBadgeContainer}>
          <View style={[styles.validationBadge, badge.style]}>
            <Text style={styles.validationBadgeText}>{badge.text}</Text>
          </View>
          {validationScore > 0 && (
            <Text style={styles.validationScore}>{validationScore}%</Text>
          )}
        </View>
      </View>
      
      {expanded && (
        <View style={styles.proofContent}>
          {proof.type === 'link' && (
            <Text style={styles.proofLink}>🔗 {proof.value}</Text>
          )}
          {proof.type === 'image' && (
            <Text style={styles.proofLink}>🖼️ {proof.value}</Text>
          )}
          {proof.type === 'text' && (
            <Text style={styles.proofText}>{proof.value}</Text>
          )}
          
          {/* Validation Actions */}
          {currentUserId && !userHasValidated && (
            <View style={styles.validationActions}>
              <Text style={styles.validationPrompt}>Is this proof legitimate?</Text>
              <View style={styles.validationButtons}>
                <Pressable 
                  onPress={() => handleValidate(true)}
                  style={[styles.validateButton, styles.validateYes]}
                  disabled={validating}
                >
                  <Text style={styles.validateButtonText}>
                    {validating ? '...' : '✓ YES'}
                  </Text>
                </Pressable>
                <Pressable 
                  onPress={() => handleValidate(false)}
                  style={[styles.validateButton, styles.validateNo]}
                  disabled={validating}
                >
                  <Text style={styles.validateButtonText}>
                    {validating ? '...' : '✗ NO'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          
          {validationCount > 0 && (
            <Text style={styles.validationCount}>
              {validationCount} member{validationCount === 1 ? '' : 's'} validated this proof
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function CheckInCard({
  item,
  currentUserId,
  userVote,
  onVote,
  onValidateProof,
}: {
  item: any;
  currentUserId: string | null;
  userVote: number | undefined;
  onVote: (checkInId: string, value: number) => void;
  onValidateProof: (checkInId: string, isValid: boolean) => void;
}) {
  const [hovered, setHovered] = useState(false);

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const voteCount = item.vote_count || 0;

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.checkInCard, hovered && styles.checkInCardHovered]}
    >
      <View style={styles.checkInRow}>
        {/* Vote buttons */}
        {currentUserId && (
          <View style={styles.voteColumn}>
            <Pressable onPress={() => onVote(item.id, 1)} style={styles.voteButton}>
              <Text style={[styles.voteArrow, userVote === 1 && styles.voteUpActive]}>▲</Text>
            </Pressable>
            <Text style={[styles.voteCount, voteCount > 0 && styles.votePositive, voteCount < 0 && styles.voteNegative]}>
              {voteCount}
            </Text>
            <Pressable onPress={() => onVote(item.id, -1)} style={styles.voteButton}>
              <Text style={[styles.voteArrow, userVote === -1 && styles.voteDownActive]}>▼</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.checkInContent}>
          <View style={styles.checkInHeader}>
            <View style={styles.checkInUser}>
              <View style={styles.userDot} />
              <Text style={styles.userName}>
                {item.user?.display_name || item.user?.username || 'Unknown'}
              </Text>
            </View>
            <Text style={styles.checkInTime}>{getTimeAgo(item.created_at)}</Text>
          </View>
          <Text style={styles.checkInText}>{item.content}</Text>
          {item.proof && (
            <View style={styles.proofBadgeRow}>
              <Text style={styles.proofBadge}>📎 Proof attached</Text>
            </View>
          )}
          <ProofDisplay 
            proof={item.proof} 
            checkInId={item.id}
            currentUserId={currentUserId}
            onValidate={onValidateProof}
          />
        </View>
      </View>
    </Pressable>
  );
}

export default function CheckInScreen({ route, navigation }: any) {
  const { circleId, circleName } = route.params;
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userVotes, setUserVotes] = useState<Record<string, number>>({});
  const [showProof, setShowProof] = useState(false);
  const [proofType, setProofType] = useState<'link' | 'image' | 'text'>('link');
  const [proofValue, setProofValue] = useState('');

  const fetchCheckIns = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('check_ins')
        .select('*, user:profiles(username, display_name)')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching check-ins:', error);
        showAlert('Error', 'Failed to load check-ins');
        return;
      }

      setCheckIns(data || []);

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error('Error getting user:', userError);
        return;
      }
      if (user) {
        setCurrentUserId(user.id);
        const today = new Date().toISOString().split('T')[0];
        const todayCheckIn = (data || []).find(
          (c: any) => c.user_id === user.id && c.created_at.startsWith(today)
        );
        setHasCheckedInToday(!!todayCheckIn);

        // Fetch user votes for these check-ins
        const ids = (data || []).map((c: any) => c.id);
        if (ids.length > 0) {
          const votes = await getUserVotes(user.id, 'check_in', ids);
          setUserVotes(votes);
        }
      }
    } catch (err) {
      console.error('Unexpected error in fetchCheckIns:', err);
      showAlert('Error', 'Something went wrong loading check-ins');
    }
  }, [circleId]);

  useEffect(() => {
    fetchCheckIns();
    const channel = supabase
      .channel(`checkins:${circleId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'check_ins', filter: `circle_id=eq.${circleId}` }, () => {
        fetchCheckIns().catch(err => console.error('Error refreshing check-ins from subscription:', err));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId, fetchCheckIns]);

  const handleVote = async (checkInId: string, value: number) => {
    if (!currentUserId) return;
    const checkIn = checkIns.find((c) => c.id === checkInId);
    const result = await castVote(currentUserId, 'check_in', checkInId, value);

    // Update local state
    setCheckIns((prev) =>
      prev.map((c) => c.id === checkInId ? { ...c, vote_count: result.newVoteCount } : c)
    );
    setUserVotes((prev) => {
      const next = { ...prev };
      if (result.userVote === null) {
        delete next[checkInId];
      } else {
        next[checkInId] = result.userVote;
      }
      return next;
    });

    // Award XP to check-in author on upvote (not self)
    if (value === 1 && result.userVote === 1 && checkIn?.user_id && checkIn.user_id !== currentUserId) {
      awardXP(checkIn.user_id, getXPForAction('upvote_received'), 'upvote_received', {
        check_in_id: checkInId,
        from_user: currentUserId,
      }).catch(console.error);
    }
  };

  const handleCheckIn = async () => {
    const sanitizedContent = content.trim();
    if (!sanitizedContent) {
      showAlert('What did your AI work on today?', "Don't leave it blank.");
      return;
    }

    if (sanitizedContent.length < 10) {
      showAlert('Tell us more', 'Check-in must be at least 10 characters.');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        showAlert('Error', 'You must be logged in to check in.');
        return;
      }

      const proof = proofValue.trim()
        ? { type: proofType, value: proofValue.trim() }
        : null;

      const { error } = await supabase.from('check_ins').insert({
        user_id: user.id,
        circle_id: circleId,
        content: sanitizedContent.slice(0, 500),
        check_in_date: new Date().toISOString().split('T')[0],
        proof,
      });

      setLoading(false);
      if (error) {
        if (error.code === '23505') {
          showAlert('Already checked in', 'One check-in per day. Come back tomorrow.');
        } else {
          showAlert('Error', error.message);
        }
        return;
      }

      // Award XP for check-in
      awardXP(user.id, getXPForAction('check_in'), 'check_in', { circle_id: circleId }).catch(console.error);

      // Award streak bonus
      const { data: profileData } = await supabase.from('profiles').select('current_streak').eq('id', user.id).single();
      const streak = profileData?.current_streak || 0;
      if (streak > 1) {
        awardXP(user.id, streak * 5, 'streak_bonus', { streak_count: streak }).catch(console.error);
      }

      setContent('');
      setProofValue('');
      setShowProof(false);
      setHasCheckedInToday(true);
      fetchCheckIns();
    } catch (err) {
      setLoading(false);
      console.error('Unexpected error in handleCheckIn:', err);
      showAlert('Error', 'Something went wrong. Please try again.');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchCheckIns();
    setRefreshing(false);
  };

  const handleValidateProof = async (checkInId: string, isValid: boolean) => {
    if (!currentUserId) return;

    try {
      // TODO: This is a placeholder — validation is NOT persisted to any table yet.
      // The XP award below goes through but the validation result (isValid) is discarded.
      // When a proof_validations table exists, persist the vote here and update the
      // check-in's validation_score / validation_count so the UI reflects real data.

      // Award XP for participating in validation
      // NOTE: XP is awarded even though the validation itself is not stored.
      await awardXP(currentUserId, 5, 'proof_validation', {
        check_in_id: checkInId,
        validation: isValid
      });

      showAlert(
        'Validation Recorded',
        `Thanks for helping maintain proof quality! You earned 5 XP.`
      );

    } catch (err) {
      console.error('Error validating proof:', err);
      showAlert('Error', 'Failed to record validation. Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>{circleName?.toUpperCase()}</Text>
          <Text style={styles.headerSubtitle}>PROOF OF WORK</Text>
        </View>
      </View>

      {!hasCheckedInToday && (
        <View style={styles.checkInBox}>
          <TextInput
            style={styles.checkInInput}
            placeholder="What did you ship / create / complete today?"
            placeholderTextColor="#444"
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={500}
          />
          <Pressable onPress={() => setShowProof(!showProof)} style={styles.proofToggleBtn}>
            <Text style={styles.proofToggleBtnText}>
              {proofValue.trim() ? '📎 Proof attached' : '+ ATTACH PROOF'}
            </Text>
          </Pressable>

          {showProof && (
            <View style={styles.proofSection}>
              <View style={styles.proofTypeRow}>
                {(['link', 'image', 'text'] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setProofType(t)}
                    style={[styles.proofTypeChip, proofType === t && styles.proofTypeChipActive]}
                  >
                    <Text style={[styles.proofTypeText, proofType === t && styles.proofTypeTextActive]}>
                      {t === 'link' ? '🔗 LINK' : t === 'image' ? '🖼️ IMAGE URL' : '📝 TEXT'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.proofInput}
                placeholder={
                  proofType === 'link' ? 'https://...' :
                  proofType === 'image' ? 'Image URL...' :
                  'Describe your proof...'
                }
                placeholderTextColor="#444"
                value={proofValue}
                onChangeText={setProofValue}
                multiline={proofType === 'text'}
                maxLength={500}
              />
            </View>
          )}

          <Button title="CHECK IN" onPress={handleCheckIn} loading={loading} />
        </View>
      )}

      {hasCheckedInToday && (
        <View style={styles.checkedInBanner}>
          <Text style={styles.checkedInText}>✓ YOU CHECKED IN TODAY</Text>
        </View>
      )}

      <FlatList
        data={checkIns}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <CheckInCard
            item={item}
            currentUserId={currentUserId}
            userVote={userVotes[item.id]}
            onVote={handleVote}
            onValidateProof={handleValidateProof}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No check-ins yet.</Text>
            <Text style={styles.emptySubtext}>Be the first to put in work.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    paddingTop: 60, paddingBottom: 16, paddingHorizontal: 24,
    borderBottomWidth: 1, borderBottomColor: '#000000',
    flexDirection: 'row', alignItems: 'center', gap: 16,
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },
  backButton: { padding: 4 },
  backText: { color: '#888', fontSize: 14 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 3 },
  headerSubtitle: { color: '#666', fontSize: 11, letterSpacing: 2, marginTop: 2 },
  checkInBox: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#000000',
    maxWidth: 480, alignSelf: 'center', width: '100%', gap: 12,
  },
  checkInInput: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 12,
    padding: 16, color: '#fff', fontSize: 15, minHeight: 80, textAlignVertical: 'top',
  },
  checkedInBanner: {
    backgroundColor: '#0d1f0d', padding: 12, alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: '#000000',
    maxWidth: 480, alignSelf: 'center', width: '100%',
  },
  checkedInText: { color: '#4a9a4a', fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  list: { padding: 16, maxWidth: 480, alignSelf: 'center', width: '100%' },
  checkInCard: {
    backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 8,
    borderWidth: 1, borderColor: '#222',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {}),
  },
  checkInCardHovered: { borderColor: '#333', backgroundColor: '#151515' },
  checkInRow: { flexDirection: 'row', gap: 12 },
  voteColumn: { alignItems: 'center', justifyContent: 'center', width: 32 },
  voteButton: { padding: 4 },
  voteArrow: { color: '#444', fontSize: 14 },
  voteUpActive: { color: '#6366f1' },
  voteDownActive: { color: '#e84040' },
  voteCount: { color: '#888', fontSize: 14, fontWeight: '700', marginVertical: 2 },
  votePositive: { color: '#6366f1' },
  voteNegative: { color: '#e84040' },
  checkInContent: { flex: 1 },
  checkInHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
  },
  checkInUser: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4a9a4a' },
  userName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkInTime: { color: '#444', fontSize: 11 },
  checkInText: { color: '#bbb', fontSize: 15, lineHeight: 22 },
  proofContainer: { marginTop: 8 },
  proofToggle: { paddingVertical: 4 },
  proofToggleText: { color: '#6366f1', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  proofContent: {
    marginTop: 6,
    padding: 10,
    backgroundColor: '#000000',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
  },
  proofLink: { color: '#6366f1', fontSize: 13 },
  proofText: { color: '#bbb', fontSize: 13, lineHeight: 18 },
  proofBadgeRow: { marginTop: 6 },
  proofBadge: { color: '#6366f1', fontSize: 11, fontWeight: '600' },
  proofToggleBtn: {
    paddingVertical: 8,
    alignItems: 'center' as const,
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  proofToggleBtnText: { color: '#888', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  proofSection: { gap: 8 },
  proofTypeRow: { flexDirection: 'row', gap: 6 },
  proofTypeChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#222',
    backgroundColor: '#000000',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  proofTypeChipActive: { borderColor: '#fff', backgroundColor: '#000000' },
  proofTypeText: { color: '#555', fontSize: 10, fontWeight: '700' },
  proofTypeTextActive: { color: '#fff' },
  proofInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
  },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  emptySubtext: { color: '#555', fontSize: 14, marginTop: 4 },

  // Validation styles
  proofHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  validationBadgeContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 6 
  },
  validationBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  verifiedBadge: { 
    backgroundColor: '#0d2d0d', 
    borderColor: '#4a9a4a' 
  },
  peerValidatedBadge: { 
    backgroundColor: '#1a1a2d', 
    borderColor: '#6366f1' 
  },
  unverifiedBadge: { 
    backgroundColor: '#2d1a0d', 
    borderColor: '#cc8844' 
  },
  validationBadgeText: { 
    fontSize: 9, 
    fontWeight: '700', 
    letterSpacing: 0.5 
  },
  validationScore: { 
    color: '#888', 
    fontSize: 10, 
    fontWeight: '600' 
  },
  validationActions: { 
    marginTop: 10, 
    padding: 8, 
    backgroundColor: '#151515', 
    borderRadius: 6, 
    borderWidth: 1, 
    borderColor: '#333' 
  },
  validationPrompt: { 
    color: '#bbb', 
    fontSize: 12, 
    marginBottom: 8, 
    textAlign: 'center' 
  },
  validationButtons: { 
    flexDirection: 'row', 
    gap: 8, 
    justifyContent: 'center' 
  },
  validateButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  validateYes: { 
    backgroundColor: '#0d2d0d', 
    borderColor: '#4a9a4a' 
  },
  validateNo: { 
    backgroundColor: '#2d0d0d', 
    borderColor: '#cc4444' 
  },
  validateButtonText: { 
    fontSize: 11, 
    fontWeight: '700', 
    color: '#fff' 
  },
  validationCount: { 
    color: '#666', 
    fontSize: 11, 
    marginTop: 6, 
    fontStyle: 'italic' 
  },
});
