import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Dimensions,
  Pressable,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import PhotonProofCheck, { PhotonProof } from '../../components/PhotonProofCheck';
import Button from '../../components/Button';
import Card from '../../components/Card';
import { Circle, PhotonProof as PhotonProofType, AgentBot } from '../../types';
import { getUserAgents, getAgentActivity } from '../../lib/agents';

interface MorningRoutineScreenProps {
  navigation: any;
  route: {
    params: {
      circleId: string;
      circleName?: string;
    };
  };
}

export default function MorningRoutineScreen({ navigation, route }: MorningRoutineScreenProps) {
  const { circleId, circleName } = route.params;
  const [showPhotonCheck, setShowPhotonCheck] = useState(false);
  const [photonCompleted, setPhotonCompleted] = useState(false);
  const [todayProof, setTodayProof] = useState<PhotonProofType | null>(null);
  const [circleData, setCircleData] = useState<Circle | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [userAgents, setUserAgents] = useState<AgentBot[]>([]);
  const [overnightActivity, setOvernightActivity] = useState<any[]>([]);

  useEffect(() => {
    loadMorningData();
  }, [circleId]);

  const loadMorningData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Load circle data
      const { data: circle } = await supabase
        .from('circles')
        .select('*')
        .eq('id', circleId)
        .single();
      
      if (circle) {
        setCircleData(circle);
      }

      // Check if user has already submitted photon proof today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: proof } = await supabase
        .from('photon_proofs')
        .select('*')
        .eq('user_id', user.id)
        .eq('circle_id', circleId)
        .gte('timestamp', today.toISOString())
        .single();

      if (proof) {
        setTodayProof(proof);
        setPhotonCompleted(true);
        setCurrentStreak(proof.streak);
      } else {
        // Get current streak
        const { data: latestProof } = await supabase
          .from('photon_proofs')
          .select('streak')
          .eq('user_id', user.id)
          .eq('circle_id', circleId)
          .order('timestamp', { ascending: false })
          .limit(1)
          .single();

        setCurrentStreak(latestProof?.streak || 0);
      }

      // Load user's agents and recent activity
      try {
        const agents = await getUserAgents();
        setUserAgents(agents);

        if (agents.length > 0) {
          // Get activity from last 8 hours (overnight)
          const eightHoursAgo = new Date();
          eightHoursAgo.setHours(eightHoursAgo.getHours() - 8);
          
          const activity = await getAgentActivity(undefined, 20);
          const recentActivity = activity.filter(a => 
            new Date(a.created_at) > eightHoursAgo
          );
          setOvernightActivity(recentActivity);
        }
      } catch (agentError) {
        console.error('Error loading agent data:', agentError);
      }
    } catch (error) {
      console.error('Error loading morning data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotonProofComplete = (proof: PhotonProof) => {
    setTodayProof({
      id: proof.id,
      user_id: proof.userId,
      circle_id: proof.circleId,
      timestamp: proof.timestamp.toISOString(),
      photo_url: proof.photoUrl,
      light_level: proof.lightLevel,
      verified: proof.verified,
      streak: proof.streak,
      latitude: proof.latitude,
      longitude: proof.longitude,
      created_at: new Date().toISOString(),
    });
    setPhotonCompleted(true);
    setCurrentStreak(proof.streak);
    setShowPhotonCheck(false);

    // Show celebration for milestones
    if (proof.streak === 7) {
      Alert.alert('🎉 Weekly Streak!', 'You\'ve maintained your photon sync for 7 days straight!');
    } else if (proof.streak === 30) {
      Alert.alert('🏆 Monthly Master!', 'An incredible 30-day photon streak! Your circadian rhythm is locked in.');
    } else if (proof.streak === 100) {
      Alert.alert('👑 Centurion Status!', '100 days of perfect photon sync! You\'ve unlocked elite status.');
    }
  };

  const getMorningGreeting = () => {
    const hour = new Date().getHours();
    const user = supabase.auth.getUser();
    
    if (hour < 6) return "Early bird! 🌅";
    if (hour < 9) return "Good morning! ☀️";
    if (hour < 12) return "Morning warrior! ⚡";
    return "Better late than never! 🌞";
  };

  const getStreakMessage = () => {
    if (currentStreak === 0) return "Ready to start your photon journey?";
    if (currentStreak < 7) return `${currentStreak} days strong! Keep building.`;
    if (currentStreak < 30) return `${currentStreak} days! You're in the zone.`;
    if (currentStreak < 100) return `${currentStreak} days! Circadian master level.`;
    return `${currentStreak} days! You're a photon legend! 👑`;
  };

  const formatTimeAgo = (dateString: string) => {
    const diff = Date.now() - new Date(dateString).getTime();
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor(diff / 60000);
    
    if (hours > 0) return `${hours}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return 'just now';
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading morning routine...</Text>
        </View>
      </View>
    );
  }

  if (showPhotonCheck) {
    return (
      <PhotonProofCheck
        circleId={circleId}
        onProofComplete={handlePhotonProofComplete}
        onCancel={() => setShowPhotonCheck(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.greeting}>{getMorningGreeting()}</Text>
          <Text style={styles.circleName}>{circleName || 'Morning Circle'}</Text>
          <Text style={styles.streakMessage}>{getStreakMessage()}</Text>
        </View>

        <View style={styles.routineSection}>
          <Card style={styles.photonCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>☀️ Photon Sync</Text>
              <View style={[styles.statusBadge, photonCompleted ? styles.completedBadge : styles.pendingBadge]}>
                <Text style={styles.statusText}>
                  {photonCompleted ? '✓ SYNCED' : 'PENDING'}
                </Text>
              </View>
            </View>
            
            {photonCompleted && todayProof ? (
              <View style={styles.completedSection}>
                <Text style={styles.completedText}>Great job! Your photon sync is complete.</Text>
                <View style={styles.proofStats}>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Light Level</Text>
                    <Text style={styles.statValue}>{todayProof.light_level}/255</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Streak</Text>
                    <Text style={styles.statValue}>{todayProof.streak} days</Text>
                  </View>
                  <View style={styles.stat}>
                    <Text style={styles.statLabel}>Status</Text>
                    <Text style={[styles.statValue, todayProof.verified ? styles.verifiedText : styles.unverifiedText]}>
                      {todayProof.verified ? 'Verified' : 'Low Light'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.timestamp}>
                  Submitted at {new Date(todayProof.timestamp).toLocaleTimeString()}
                </Text>
              </View>
            ) : (
              <View style={styles.pendingSection}>
                <Text style={styles.description}>
                  Start your day by capturing morning sunlight. This helps regulate your circadian rhythm 
                  and unlocks your daily app features.
                </Text>
                <Button
                  title="Begin Photon Sync ☀️"
                  onPress={() => setShowPhotonCheck(true)}
                  style={styles.syncButton}
                />
              </View>
            )}
          </Card>

          {userAgents.length > 0 && (
            <Card style={styles.agentSummaryCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>🤖 Agent Overnight Summary</Text>
                <View style={[styles.statusBadge, overnightActivity.length > 0 ? styles.activeBadge : styles.quietBadge]}>
                  <Text style={styles.statusText}>
                    {overnightActivity.length > 0 ? `${overnightActivity.length} UPDATES` : 'QUIET NIGHT'}
                  </Text>
                </View>
              </View>

              {overnightActivity.length > 0 ? (
                <View style={styles.activitySummary}>
                  <Text style={styles.summaryText}>
                    Your agents worked while you slept! Here's what happened:
                  </Text>
                  
                  <View style={styles.activityList}>
                    {overnightActivity.slice(0, 3).map((activity, index) => (
                      <View key={activity.id} style={styles.activityItem}>
                        <Text style={styles.activityDot}>•</Text>
                        <View style={styles.activityContent}>
                          <Text style={styles.activityType}>
                            {activity.metadata.activity_type?.replace('_', ' ').toUpperCase() || 'ACTIVITY'}
                          </Text>
                          <Text style={styles.activityTime}>
                            {formatTimeAgo(activity.created_at)}
                          </Text>
                          {activity.metadata.agent_response && (
                            <Text style={styles.activitySnippet} numberOfLines={2}>
                              {activity.metadata.agent_response.slice(0, 80)}...
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>

                  {overnightActivity.length > 3 && (
                    <Text style={styles.moreActivity}>
                      +{overnightActivity.length - 3} more activities
                    </Text>
                  )}
                </View>
              ) : (
                <View style={styles.quietNight}>
                  <Text style={styles.quietText}>
                    Your agents had a quiet night. They're ready for action when you need them!
                  </Text>
                  <Text style={styles.agentCount}>
                    {userAgents.filter(a => a.is_active).length} active agents standing by
                  </Text>
                </View>
              )}

              <Pressable
                style={styles.viewAgentsButton}
                onPress={() => navigation.navigate('Agents')}
              >
                <Text style={styles.viewAgentsText}>View All Agent Activity →</Text>
              </Pressable>
            </Card>
          )}

          {photonCompleted && (
            <Card style={styles.nextStepsCard}>
              <Text style={styles.cardTitle}>🎯 Next Steps Unlocked</Text>
              <View style={styles.nextStepsList}>
                <View style={styles.nextStep}>
                  <Text style={styles.nextStepIcon}>📊</Text>
                  <View style={styles.nextStepContent}>
                    <Text style={styles.nextStepTitle}>Circle Dashboard</Text>
                    <Text style={styles.nextStepDesc}>Check your circle's morning progress</Text>
                  </View>
                </View>
                <View style={styles.nextStep}>
                  <Text style={styles.nextStepIcon}>⚡</Text>
                  <View style={styles.nextStepContent}>
                    <Text style={styles.nextStepTitle}>Focus Sessions</Text>
                    <Text style={styles.nextStepDesc}>Join synchronized deep work blocks</Text>
                  </View>
                </View>
                <View style={styles.nextStep}>
                  <Text style={styles.nextStepIcon}>💬</Text>
                  <View style={styles.nextStepContent}>
                    <Text style={styles.nextStepTitle}>Circle Chat</Text>
                    <Text style={styles.nextStepDesc}>Connect with your morning crew</Text>
                  </View>
                </View>
              </View>
              
              <Button
                title="Go to Circle Dashboard"
                variant="secondary"
                onPress={() => navigation.navigate('CircleDetail', { circleId, circleName })}
                style={styles.dashboardButton}
              />
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 16,
    paddingTop: 60,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  greeting: {
    color: '#fbbf24',
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 8,
  },
  circleName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  streakMessage: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
  routineSection: {
    gap: 16,
  },
  photonCard: {
    backgroundColor: '#111',
    borderWidth: 2,
    borderColor: '#fbbf24',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  completedBadge: {
    backgroundColor: '#065f46',
  },
  pendingBadge: {
    backgroundColor: '#92400e',
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  completedSection: {
    alignItems: 'center',
  },
  completedText: {
    color: '#10b981',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  proofStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 12,
  },
  stat: {
    alignItems: 'center',
  },
  statLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  verifiedText: {
    color: '#10b981',
  },
  unverifiedText: {
    color: '#f59e0b',
  },
  timestamp: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
  },
  pendingSection: {
    alignItems: 'center',
  },
  description: {
    color: '#ccc',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  syncButton: {
    backgroundColor: '#fbbf24',
    minWidth: 200,
  },
  nextStepsCard: {
    backgroundColor: '#111',
  },
  nextStepsList: {
    marginTop: 16,
    gap: 16,
  },
  nextStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nextStepIcon: {
    fontSize: 24,
    width: 32,
  },
  nextStepContent: {
    flex: 1,
  },
  nextStepTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  nextStepDesc: {
    color: '#888',
    fontSize: 12,
  },
  dashboardButton: {
    marginTop: 20,
  },
  // Agent Summary styles
  agentSummaryCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  activeBadge: {
    backgroundColor: '#065f46',
  },
  quietBadge: {
    backgroundColor: '#374151',
  },
  activitySummary: {
    marginTop: 12,
  },
  summaryText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  activityList: {
    gap: 12,
    marginBottom: 16,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  activityDot: {
    color: '#6366f1',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  activityContent: {
    flex: 1,
  },
  activityType: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 2,
  },
  activityTime: {
    color: '#666',
    fontSize: 10,
    marginBottom: 4,
  },
  activitySnippet: {
    color: '#ccc',
    fontSize: 12,
    lineHeight: 16,
  },
  moreActivity: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 8,
  },
  quietNight: {
    alignItems: 'center',
    marginTop: 12,
  },
  quietText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  agentCount: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '600',
  },
  viewAgentsButton: {
    marginTop: 16,
    paddingVertical: 8,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  viewAgentsText: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '600',
  },
});