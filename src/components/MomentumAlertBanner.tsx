// Momentum Alert Banner - Engagement Hook UI Component
// Displays time-sensitive social triggers to drive user engagement

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { MomentumAlert, useMomentumAlerts } from '../lib/momentumAlerts';
import { useAuth } from '../hooks/useAuth';

interface MomentumAlertBannerProps {
  userCircleIds: string[];
  onAlertAction?: (alert: MomentumAlert) => void;
}

export function MomentumAlertBanner({ userCircleIds, onAlertAction }: MomentumAlertBannerProps) {
  const { user } = useAuth();
  const { alerts, dismissAlert } = useMomentumAlerts(user?.id || '', userCircleIds);
  const [fadeAnim] = React.useState(new Animated.Value(0));

  // Show only the highest urgency alert
  const topAlert = alerts
    .sort((a, b) => {
      const urgencyOrder = { 'high': 3, 'medium': 2, 'low': 1 };
      return urgencyOrder[b.urgencyLevel] - urgencyOrder[a.urgencyLevel];
    })[0];

  React.useEffect(() => {
    if (topAlert) {
      // Fade in animation
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    } else {
      fadeAnim.setValue(0);
    }
  }, [topAlert, fadeAnim]);

  if (!topAlert) return null;

  const handleAction = async () => {
    if (onAlertAction) {
      onAlertAction(topAlert);
    }
    await dismissAlert(topAlert.id);
  };

  const handleDismiss = async () => {
    // Fade out animation
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      dismissAlert(topAlert.id);
    });
  };

  const getAlertStyles = (urgency: string) => {
    switch (urgency) {
      case 'high':
        return {
          backgroundColor: '#dc2626', // red-600
          borderColor: '#ef4444', // red-500
        };
      case 'medium':
        return {
          backgroundColor: '#ea580c', // orange-600
          borderColor: '#f97316', // orange-500
        };
      default:
        return {
          backgroundColor: '#16a34a', // green-600
          borderColor: '#22c55e', // green-500
        };
    }
  };

  const timeLeft = Math.max(0, Math.floor((topAlert.expiresAt.getTime() - Date.now()) / 60000));

  return (
    <Animated.View 
      style={[
        styles.container,
        getAlertStyles(topAlert.urgencyLevel),
        { opacity: fadeAnim }
      ]}
    >
      <View style={styles.content}>
        {/* Alert Info */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>{topAlert.title}</Text>
          <Text style={styles.message}>{topAlert.message}</Text>
          
          {/* Show XP bonus if available */}
          {topAlert.xpBonus && (
            <View style={styles.bonusContainer}>
              <Text style={styles.bonusText}>⚡ +{topAlert.xpBonus} Bonus XP</Text>
            </View>
          )}
          
          {/* Time remaining */}
          {timeLeft > 0 && (
            <Text style={styles.timeLeft}>
              ⏰ {timeLeft}m left
            </Text>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleAction}
            activeOpacity={0.8}
          >
            <Text style={styles.actionButtonText}>
              {topAlert.actionText}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.dismissButton}
            onPress={handleDismiss}
            activeOpacity={0.6}
          >
            <Text style={styles.dismissButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
      
      {/* Progress bar showing time remaining */}
      {timeLeft > 0 && (
        <View style={styles.progressContainer}>
          <View 
            style={[
              styles.progressBar,
              { 
                width: `${Math.max(5, (timeLeft / 60) * 100)}%` // Assume 60min max
              }
            ]}
          />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 2,
    margin: 16,
    marginBottom: 8,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
  },
  textContainer: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 20,
  },
  message: {
    fontSize: 14,
    color: '#f3f4f6', // gray-100
    marginBottom: 8,
    lineHeight: 18,
  },
  bonusContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  bonusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ffffff',
  },
  timeLeft: {
    fontSize: 12,
    color: '#d1d5db', // gray-300
    fontWeight: '500',
  },
  buttonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937', // gray-800
  },
  dismissButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
  },
  progressContainer: {
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#ffffff',
  },
});

export default MomentumAlertBanner;