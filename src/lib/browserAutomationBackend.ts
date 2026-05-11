import type { BrowserTaskIntent } from './browserTaskIntent';

export type BrowserAutomationBackendPreference = {
  backend: 'local_browser_bridge' | 'browserbase_stagehand';
  reason: string;
  costTier: 'free_local' | 'metered_remote';
};

/**
 * Pure routing policy for browser automation. The app should spend remote
 * Browserbase/Stagehand sessions only when the task shape needs them.
 */
export function chooseBrowserAutomationBackendPreference(intent?: BrowserTaskIntent): BrowserAutomationBackendPreference {
  if (!intent) {
    return {
      backend: 'local_browser_bridge',
      costTier: 'free_local',
      reason: 'No browser intent was provided, so defaulting to the local browser bridge.',
    };
  }

  const task = intent.objective || '';
  if (/\b(browserbase|remote browser|cloud browser|live session)\b/i.test(task)) {
    return {
      backend: 'browserbase_stagehand',
      costTier: 'metered_remote',
      reason: 'The task explicitly requested a Browserbase/cloud browser session.',
    };
  }

  if (intent.browserbaseWorkflow.requiresStagehand || intent.browserbaseWorkflow.kind === 'stagehand_browser_agent') {
    return {
      backend: 'browserbase_stagehand',
      costTier: 'metered_remote',
      reason: 'The task explicitly needs Stagehand-style semantic browser automation.',
    };
  }

  if (/\b(local browser|desktop browser|my browser|my chrome|my safari|on my computer|on my desktop|uc chrome profile|uc profile)\b/i.test(task)) {
    return {
      backend: 'local_browser_bridge',
      costTier: 'free_local',
      reason: 'The task explicitly requested the local desktop browser/profile.',
    };
  }

  if (intent.browserbaseWorkflow.kind === 'form_submission') {
    return {
      backend: 'browserbase_stagehand',
      costTier: 'metered_remote',
      reason: 'Form submissions need a durable live browser session and verification trail.',
    };
  }

  if (intent.requiresLogin) {
    if (!intent.hasSideEffects) {
      return {
        backend: 'local_browser_bridge',
        costTier: 'free_local',
        reason: 'Read-only login/account tasks should reuse the local persistent browser profile to avoid remote session cost.',
      };
    }
    return {
      backend: 'browserbase_stagehand',
      costTier: 'metered_remote',
      reason: 'Login/account tasks benefit from a persistent cloud browser session when Browserbase is connected.',
    };
  }

  if (intent.hasSideEffects && intent.risk === 'high') {
    return {
      backend: 'browserbase_stagehand',
      costTier: 'metered_remote',
      reason: 'High-risk browser workflows need stronger live-session auditing.',
    };
  }

  return {
    backend: 'local_browser_bridge',
    costTier: 'free_local',
    reason: 'Simple read-only/extract browser work should stay on the local browser bridge to reduce cost.',
  };
}
