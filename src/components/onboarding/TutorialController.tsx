import React, { useState, useEffect, useCallback } from 'react';
import {
  loadOnboardingProgress,
  completeOnboardingStep,
  getNextStep,
  isOnboardingComplete,
  ONBOARDING_STEPS,
  OnboardingStep,
} from '../../lib/onboardingSteps';
import TutorialOverlay from './TutorialOverlay';

// ─── Props ──────────────────────────────────────────────────────────────────

interface TutorialControllerProps {
  circleId: string;
}

// ─── TutorialController ─────────────────────────────────────────────────────

export default function TutorialController({ circleId }: TutorialControllerProps) {
  const [progress, setProgress] = useState<Record<string, boolean>>({});
  const [currentStep, setCurrentStep] = useState<OnboardingStep | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load saved progress on mount
  useEffect(() => {
    let cancelled = false;
    loadOnboardingProgress().then((saved) => {
      if (cancelled) return;
      setProgress(saved);
      const next = getNextStep(saved);
      setCurrentStep(next);
      // If onboarding is already complete, don't show
      if (isOnboardingComplete(saved)) {
        setDismissed(true);
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [circleId]);

  // Handle "Next" — complete current step and advance
  const handleNext = useCallback(async () => {
    if (!currentStep) return;

    const stepId = currentStep.id;
    await completeOnboardingStep(stepId);

    const updated = { ...progress, [stepId]: true };
    setProgress(updated);

    const next = getNextStep(updated);
    if (next) {
      setCurrentStep(next);
    } else {
      // All done
      setCurrentStep(null);
      setDismissed(true);
    }
  }, [currentStep, progress]);

  // Handle "Skip" — dismiss the entire tutorial
  const handleSkip = useCallback(async () => {
    // Mark all steps complete so tutorial never shows again
    const allDone: Record<string, boolean> = {};
    for (const step of ONBOARDING_STEPS) {
      allDone[step.id] = true;
    }
    setProgress(allDone);
    setCurrentStep(null);
    setDismissed(true);

    // Persist — mark all as complete
    for (const step of ONBOARDING_STEPS) {
      await completeOnboardingStep(step.id);
    }
  }, []);

  // Listen for external completion signals
  // Other components can call completeOnboardingStep() directly,
  // and this controller will pick up changes on next render.
  // For real-time responsiveness, we poll every 3 seconds while tutorial is active.
  useEffect(() => {
    if (dismissed || !loaded) return;

    const interval = setInterval(async () => {
      const latest = await loadOnboardingProgress();
      setProgress(latest);
      const next = getNextStep(latest);
      if (!next) {
        setCurrentStep(null);
        setDismissed(true);
      } else if (next.id !== currentStep?.id) {
        setCurrentStep(next);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [dismissed, loaded, currentStep?.id]);

  // Don't render anything if dismissed, not loaded, or no step
  if (!loaded || dismissed || !currentStep) return null;

  // Find step number (1-based)
  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === currentStep.id);
  const stepNumber = stepIndex >= 0 ? stepIndex + 1 : 1;

  return (
    <TutorialOverlay
      step={currentStep}
      stepNumber={stepNumber}
      totalSteps={ONBOARDING_STEPS.length}
      onNext={handleNext}
      onSkip={handleSkip}
    />
  );
}
