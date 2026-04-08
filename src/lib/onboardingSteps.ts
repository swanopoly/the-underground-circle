import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Onboarding Step Types ──────────────────────────────────────────────────

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  action: string; // what the user needs to do
  target: string; // screen or element to highlight
  completed: boolean;
}

// ─── Tutorial Steps ─────────────────────────────────────────────────────────

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to The Underground Circle',
    description: 'Your AI-powered workspace. Let\'s get you set up in 5 minutes.',
    action: 'Tap Next to begin',
    target: 'welcome',
    completed: false,
  },
  {
    id: 'explore-office',
    title: 'This is Your Office',
    description: 'Your AI agents live here as pixel characters. They work while you sleep.',
    action: 'Look around \u2014 your agents are at their desks',
    target: 'office',
    completed: false,
  },
  {
    id: 'meet-agent',
    title: 'Meet BlackSwan \u2014 Your AI Agent',
    description: 'BlackSwan is always here. It knows your circle, your tasks, and your goals.',
    action: 'Tap on BlackSwan to see its profile',
    target: 'agent-blackswan',
    completed: false,
  },
  {
    id: 'first-chat',
    title: 'Talk to Your Agent',
    description: 'Go to Chat and say anything. The agent always responds \u2014 no @mention needed.',
    action: 'Send a message in Chat',
    target: 'chat',
    completed: false,
  },
  {
    id: 'create-task',
    title: 'Create Your First Task',
    description: 'Go to Feed and create a task. This is what your agents will work on.',
    action: 'Create a task in the Feed tab',
    target: 'feed',
    completed: false,
  },
  {
    id: 'assign-agent',
    title: 'Assign an Agent to Your Task',
    description: 'Open Actions in chat and tap "Assign Agent". Pick BlackSwan and describe what to do.',
    action: 'Assign a task to an agent',
    target: 'assign',
    completed: false,
  },
  {
    id: 'connect-integration',
    title: 'Connect Your First Service',
    description: 'Go to Integrations and connect GitHub, WordPress, or another service your agent can use.',
    action: 'Connect at least one integration',
    target: 'integrations',
    completed: false,
  },
  {
    id: 'automate',
    title: 'Run Your First Automation',
    description: 'Your agent can now post to WordPress, manage GitHub, or run any task you assign. Try it!',
    action: 'Send a task to your agent and watch it work',
    target: 'automation',
    completed: false,
  },
];

// ─── Storage Key ────────────────────────────────────────────────────────────

const ONBOARDING_STORAGE_KEY = 'uc_onboarding_progress';

// ─── Load Progress ──────────────────────────────────────────────────────────

export async function loadOnboardingProgress(): Promise<Record<string, boolean>> {
  try {
    const raw = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as Record<string, boolean>;
    }
  } catch (err) {
    console.warn('[Onboarding] Failed to load progress:', err);
  }
  return {};
}

// ─── Complete Step ──────────────────────────────────────────────────────────

export async function completeOnboardingStep(stepId: string): Promise<void> {
  try {
    const progress = await loadOnboardingProgress();
    progress[stepId] = true;
    await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(progress));
  } catch (err) {
    console.warn('[Onboarding] Failed to save step:', err);
  }
}

// ─── Get Next Incomplete Step ───────────────────────────────────────────────

export function getNextStep(progress: Record<string, boolean>): OnboardingStep | null {
  for (const step of ONBOARDING_STEPS) {
    if (!progress[step.id]) {
      return { ...step, completed: false };
    }
  }
  return null;
}

// ─── Check if All Done ─────────────────────────────────────────────────────

export function isOnboardingComplete(progress: Record<string, boolean>): boolean {
  return ONBOARDING_STEPS.every((step) => progress[step.id] === true);
}
