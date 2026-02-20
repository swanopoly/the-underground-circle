import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getCurrentMultiplier, getNextMultiplier, formatTimeUntil } from '../lib/peakHours';
import type { PeakHours } from '../lib/peakHours';

interface PeakHoursIndicatorProps {
  style?: any;
}

export default function PeakHoursIndicator({ style }: PeakHoursIndicatorProps) {
  const [currentMultiplier, setCurrentMultiplier] = useState<PeakHours | null>(null);
  const [nextPeriod, setNextPeriod] = useState<{ period: PeakHours; minutesUntil: number } | null>(null);

  useEffect(() => {
    const updateStatus = () => {
      setCurrentMultiplier(getCurrentMultiplier());
      setNextPeriod(getNextMultiplier());
    };

    updateStatus();
    const interval = setInterval(updateStatus, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  if (currentMultiplier) {
    return (
      <View style={[styles.container, styles.activeContainer, style]}>
        <View style={styles.activeIndicator}>
          <Text style={styles.activeEmoji}>{currentMultiplier.emoji}</Text>
          <View style={styles.activeText}>
            <Text style={styles.activeLabel}>{currentMultiplier.name.toUpperCase()}</Text>
            <Text style={styles.activeMultiplier}>{currentMultiplier.multiplier}X XP</Text>
          </View>
          <View style={styles.pulseIndicator} />
        </View>
      </View>
    );
  }

  if (nextPeriod && nextPeriod.minutesUntil < 120) { // Show next period if within 2 hours
    return (
      <View style={[styles.container, styles.nextContainer, style]}>
        <Text style={styles.nextEmoji}>{nextPeriod.period.emoji}</Text>
        <View style={styles.nextText}>
          <Text style={styles.nextLabel}>NEXT BOOST</Text>
          <Text style={styles.nextTime}>
            {nextPeriod.period.multiplier}x in {formatTimeUntil(nextPeriod.minutesUntil)}
          </Text>
        </View>
      </View>
    );
  }

  return null; // Don't show anything if no upcoming boosts
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  activeContainer: {
    backgroundColor: '#1a2f1a',
    borderColor: '#4a9a4a',
  },
  nextContainer: {
    backgroundColor: '#1a1a2f',
    borderColor: '#4a4a9a',
  },
  activeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeEmoji: {
    fontSize: 16,
  },
  activeText: {
    flex: 1,
  },
  activeLabel: {
    color: '#4a9a4a',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  activeMultiplier: {
    color: '#66cc66',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 1,
  },
  pulseIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4a9a4a',
    // Note: CSS animations don't work in React Native, would need Animated API for actual pulse
  },
  nextEmoji: {
    fontSize: 14,
    opacity: 0.7,
  },
  nextText: {
    flex: 1,
    marginLeft: 8,
  },
  nextLabel: {
    color: '#666',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  nextTime: {
    color: '#888',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
});