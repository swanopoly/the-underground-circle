import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { OnboardingStep } from '../../lib/onboardingSteps';

// ─── Props ──────────────────────────────────────────────────────────────────

interface TutorialOverlayProps {
  step: OnboardingStep;
  stepNumber: number;
  totalSteps: number;
  onNext: () => void;
  onSkip: () => void;
}

// ─── TutorialOverlay ────────────────────────────────────────────────────────

export default function TutorialOverlay({
  step,
  stepNumber,
  totalSteps,
  onNext,
  onSkip,
}: TutorialOverlayProps) {
  const slideAnim = useRef(new Animated.Value(200)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slide in from bottom + fade in
    slideAnim.setValue(200);
    fadeAnim.setValue(0);
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 60,
        friction: 12,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [step.id]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY: slideAnim }],
          opacity: fadeAnim,
        },
      ]}
      pointerEvents="box-none"
      nativeID="section-onboarding-overlay"
    >
      <View style={styles.card}>
        {/* ── Progress Dots ── */}
        <View style={styles.progressRow}>
          <Text style={styles.stepCounter}>
            Step {stepNumber} of {totalSteps}
          </Text>
          <View style={styles.dotsRow}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i + 1 < stepNumber && styles.dotCompleted,
                  i + 1 === stepNumber && styles.dotActive,
                ]}
              />
            ))}
          </View>
        </View>

        {/* ── Title ── */}
        <Text style={styles.title}>{step.title}</Text>

        {/* ── Description ── */}
        <Text style={styles.description} numberOfLines={2}>
          {step.description}
        </Text>

        {/* ── Action ── */}
        <Text style={styles.action}>{step.action}</Text>

        {/* ── Buttons ── */}
        <View style={styles.buttonRow}>
          <Pressable onPress={onSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip Tutorial</Text>
          </Pressable>
          <Pressable onPress={onNext} style={styles.nextButton}>
            <Text style={styles.nextText}>Next</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const ACCENT = '#22c55e';
const ACCENT_DIM = '#22c55e40';

const styles = StyleSheet.create({
  container: {
    position: 'absolute' as any,
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: Platform.OS === 'web' ? 16 : 32,
    zIndex: 90,
    pointerEvents: 'box-none' as any,
  },
  card: {
    backgroundColor: '#0f0f18',
    borderWidth: 2,
    borderColor: ACCENT_DIM,
    borderRadius: 2,
    padding: 16,
    maxWidth: 480,
    alignSelf: 'center' as any,
    width: '100%',
    ...(Platform.OS === 'web'
      ? ({
          boxShadow: `0 0 20px ${ACCENT_DIM}, 4px 4px 0px #050508`,
        } as any)
      : {
          shadowColor: ACCENT,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.3,
          shadowRadius: 20,
          elevation: 10,
        }),
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  stepCounter: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#2a2a3e',
  },
  dotCompleted: {
    backgroundColor: ACCENT,
  },
  dotActive: {
    backgroundColor: ACCENT,
    ...(Platform.OS === 'web'
      ? ({
          boxShadow: `0 0 6px ${ACCENT}`,
        } as any)
      : {
          shadowColor: ACCENT,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 6,
        }),
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: '800',
    color: '#f0f0f0',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  description: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '500',
    color: '#888',
    lineHeight: 18,
    marginBottom: 8,
  },
  action: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: ACCENT,
    marginBottom: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skipButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  skipText: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
    color: '#555',
    letterSpacing: 0.5,
  },
  nextButton: {
    backgroundColor: ACCENT,
    paddingVertical: 8,
    paddingHorizontal: 24,
    borderRadius: 2,
    borderWidth: 2,
    borderColor: ACCENT,
  },
  nextText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '800',
    color: '#050508',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
