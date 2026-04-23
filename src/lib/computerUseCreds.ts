/**
 * computerUseCreds — single source of truth for fetching the browser
 * credentials the Computer Use agent needs. Today: Browserbase. Designed
 * so additional runtimes (self-hosted Playwright, Hyperbrowser, Anthropic
 * Managed Agents) can slot in without touching the chat layer.
 */

import { getCircleIntegration, getCircleIntegrationSecretValues } from './circleIntegrations';

export interface BrowserbaseCreds {
  apiKey: string;
  projectId: string;
  region?: string;
}

export interface ComputerUseCreds {
  /** Runtime identifier. Extend when new runtimes land. */
  runtime: 'browserbase';
  browserbase: BrowserbaseCreds;
}

export async function resolveComputerUseCreds(circleId: string): Promise<
  { ok: true; creds: ComputerUseCreds } | { ok: false; reason: string }
> {
  try {
    const integration = await getCircleIntegration(circleId, 'browserbase');
    if (!integration || integration.is_active === false || integration.status === 'disabled') {
      return { ok: false, reason: 'Browserbase isn\'t connected for this circle. Add it in Marketplace → Browserbase.' };
    }
    const secrets = await getCircleIntegrationSecretValues(integration.id);
    const apiKey = String(secrets.api_key || '').trim();
    const projectId = String(secrets.project_id || '').trim();
    const region = String(secrets.session_region || '').trim() || undefined;
    if (!apiKey || !projectId) {
      return { ok: false, reason: 'Browserbase is connected but missing api_key or project_id. Edit the integration to add them.' };
    }
    return {
      ok: true,
      creds: { runtime: 'browserbase', browserbase: { apiKey, projectId, region } },
    };
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'Failed to load Browserbase credentials.' };
  }
}
