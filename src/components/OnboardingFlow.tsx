import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  Platform,
} from 'react-native';

const ONBOARDING_KEY = 'uc_onboarding_complete';

export function isOnboardingComplete(): boolean {
  if (Platform.OS !== 'web') return true; // mobile: skip for now
  try {
    return localStorage.getItem(ONBOARDING_KEY) === '1';
  } catch {
    return true;
  }
}

function markOnboardingComplete() {
  if (Platform.OS === 'web') {
    try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
  }
}

interface Props {
  userId: string;
  circleId?: string;
  onComplete: () => void;
}

export default function OnboardingFlow({ userId, circleId, onComplete }: Props) {
  const [step, setStep] = useState(0);

  const handleFinish = useCallback(() => {
    markOnboardingComplete();
    onComplete();
  }, [onComplete]);

  const totalSteps = 3;

  return (
    <Modal transparent animationType="fade" visible>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.stepRow}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View
                key={i}
                style={[styles.stepDot, i === step && styles.stepDotActive, i < step && styles.stepDotDone]}
              />
            ))}
          </View>

          {step === 0 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Ship Together{'\n'}Stay Accountable</Text>
              <Text style={styles.sub}>
                The Underground Circle is where teams set goals, assign AI agents, and prove they shipped.{'\n\n'}
                No more standups. No more "what are you working on?" Just missions, proof, and results.
              </Text>
              <Pressable onPress={() => setStep(1)} style={styles.ctaBtn}>
                <Text style={styles.ctaBtnText}>How it works</Text>
              </Pressable>
            </View>
          )}

          {step === 1 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Missions + AI Agents</Text>
              <Text style={styles.sub}>
                Create missions with deadlines and tasks. Assign BlackSwan (your built-in AI) to monitor progress, review code, and nudge slackers.{'\n\n'}
                Every commit, PR, and completed task becomes visible proof-of-work for your team.
              </Text>
              <Pressable onPress={() => setStep(2)} style={styles.ctaBtn}>
                <Text style={styles.ctaBtnText}>Got it</Text>
              </Pressable>
            </View>
          )}

          {step === 2 && (
            <View style={styles.stepContent}>
              <Text style={styles.heading}>Create Your Circle</Text>
              <Text style={styles.sub}>
                Start a circle, invite your team, and create your first mission.{'\n\n'}
                Connect GitHub to auto-track commits and PRs. BlackSwan handles the rest.
              </Text>
              <Pressable onPress={handleFinish} style={styles.ctaBtn}>
                <Text style={styles.ctaBtnText}>Let's ship</Text>
              </Pressable>
            </View>
          )}

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    backgroundColor: '#0a0a0a',
    borderWidth: 2,
    borderColor: '#1a1a2e',
    borderRadius: 2,
    padding: 32,
    width: '100%',
    maxWidth: 440,
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  stepDotActive: {
    backgroundColor: '#6366f1',
    width: 24,
  },
  stepDotDone: {
    backgroundColor: '#22c55e',
  },
  stepContent: {
    alignItems: 'center',
    gap: 12,
  },
  heading: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
    textAlign: 'center',
    letterSpacing: 1,
    lineHeight: 28,
  },
  sub: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 8,
  },
  ctaBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 2,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    borderWidth: 2,
    borderColor: '#818cf8',
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  githubBtn: {
    backgroundColor: '#238636',
    borderRadius: 2,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: '100%',
    borderWidth: 2,
    borderColor: '#2ea043',
  },
  githubBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  btnDisabled: { opacity: 0.5 },
  skipBtn: {
    paddingVertical: 8,
  },
  skipText: {
    color: '#666',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  inviteBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 2,
    padding: 10,
    width: '100%',
    gap: 8,
  },
  inviteUrl: {
    flex: 1,
    color: '#6366f1',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  copyBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 2,
  },
  copyBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
