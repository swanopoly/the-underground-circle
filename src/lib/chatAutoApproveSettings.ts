/**
 * chatAutoApproveSettings — per-category approval policy (Cline research
 * item 2). The `chatApprovalGate` consults this before filing an
 * `agent_approvals` row: if the resolved decision is `'auto'`, the plan
 * passes through without a proposal. If `'never'`, the gate denies
 * outright. If `'ask'` (the default) the existing behavior runs.
 *
 * Storage lives in two layers so users can opt-in per circle but also
 * blanket-opt-in globally (useful for solo users):
 *   - `circles.settings.autoApprove`  — circle-scoped, JSONB
 *   - `profiles.office_preferences.autoApprove` — per-user global default
 *
 * This file is the pure logic + read/write API. UI that flips the
 * settings lives next to `HitlApprovalBanner.tsx` (the "remember this"
 * checkbox) and eventually a settings pane.
 */

import { supabase } from './supabase';
import type { ChatAutomationPlan } from './chatAutomationPlanner';

export type AutoApproveDecision = 'ask' | 'auto' | 'never';

export type AutoApproveCategory =
  | 'memory_read'
  | 'memory_write'
  | 'skill_run'
  | 'skill_write'
  | 'automation_create'
  | 'automation_run'
  | 'browser_click'
  | 'external_publish'
  | 'desktop_action';      // launch / focus / type / keys via the local bridge (Phase 1b)

export type AutoApproveSettings = Partial<Record<AutoApproveCategory, AutoApproveDecision>>;

const DEFAULT_SETTINGS: AutoApproveSettings = {
  memory_read: 'auto',
  memory_write: 'ask',
  skill_run: 'ask',
  skill_write: 'ask',
  automation_create: 'ask',
  automation_run: 'ask',
  browser_click: 'ask',
  external_publish: 'ask',
  desktop_action: 'ask',   // default-ask — every desktop tool call hits the HITL banner first time
};

// ─── Category classifier ────────────────────────────────────────────────────

/** Maps a plan to its auto-approve category. Undefined → no category
 *  applies, fall back to the plan's own `approval.required` bit. */
export function planCategory(plan: ChatAutomationPlan): AutoApproveCategory | null {
  const { execution, intent } = plan;
  const route = execution.routeId || '';

  if (route === 'memory') {
    // Show/list/forget vs remember — conversational intent disambiguates.
    if (intent.kind === 'conversational_action') {
      switch (intent.intent.type) {
        case 'show_memories':
        case 'forget':
          return 'memory_read';
        case 'remember':
          return 'memory_write';
      }
    }
    // Fallback: slash `/memory` commands — if the command text contains
    // `write|save|remember` treat as write, else read.
    const text = (execution.commandText || '').toLowerCase();
    if (/\b(remember|save|note|store|write)\b/.test(text)) return 'memory_write';
    return 'memory_read';
  }

  // Computer tasks carry a typed route decision; desktop_app/local_file/
  // hybrid lanes run through the LOCAL bridge, not the browser — classify
  // them as desktop_action so the desktop auto-approve category actually
  // applies. (The execution routeId is hardcoded 'browser' as a transport
  // tag for these plans, which previously miscategorized a "open Photoshop"
  // sequence as browser_click — a category the user never opted into.)
  const computerKind = plan.computerRequestRoute?.kind;
  if (computerKind === 'desktop_app' || computerKind === 'local_file' || computerKind === 'hybrid') {
    return 'desktop_action';
  }

  if (route === 'browser') return 'browser_click';
  if (route === 'wordpress') return 'external_publish';
  if (route === 'governance') return 'external_publish';

  if (execution.kind === 'create_circle_automation') return 'automation_create';
  if (execution.kind === 'run_circle_automation') return 'automation_run';

  // Desktop (bridge) tool calls — classified by route `open_app` (the
  // Phase 1b router tag) or by commandText prefix `/desktop ...`.
  // `route` was broadened to a narrower union in a recent refactor; the
  // `open_app` / `desktop` values were removed. We still want to catch
  // those route strings if an older caller sends them, hence the cast.
  const routeStr = route as string;
  if (routeStr === 'open_app' || routeStr === 'desktop' || (execution.commandText || '').toLowerCase().startsWith('/desktop ')) {
    return 'desktop_action';
  }

  // Skill tool kinds — commandText encodes /skill run|import|...
  const text = (execution.commandText || '').toLowerCase();
  if (text.startsWith('/skill ')) {
    if (/\b(import|write|publish|save)\b/.test(text)) return 'skill_write';
    if (/\b(run|execute|invoke)\b/.test(text)) return 'skill_run';
  }

  return null;
}

/** Resolve the decision for a plan, consulting circle-scoped then
 *  user-scoped settings then the default. */
export async function resolveAutoApproveDecision(
  plan: ChatAutomationPlan,
  opts: { circleId: string; userId: string },
): Promise<{ category: AutoApproveCategory | null; decision: AutoApproveDecision }> {
  const category = planCategory(plan);
  if (!category) return { category: null, decision: 'ask' };

  // Circle-scoped first (explicit circle policy wins over user default).
  const circleDecision = await readCircleAutoApprove(opts.circleId).catch(() => null);
  const circleChoice = circleDecision?.[category];
  if (circleChoice && circleChoice !== 'ask') return { category, decision: circleChoice };

  const userDecision = await readUserAutoApprove(opts.userId).catch(() => null);
  const userChoice = userDecision?.[category];
  if (userChoice && userChoice !== 'ask') return { category, decision: userChoice };

  return { category, decision: DEFAULT_SETTINGS[category] || 'ask' };
}

// ─── Circle-scoped read/write ──────────────────────────────────────────────

export async function readCircleAutoApprove(circleId: string): Promise<AutoApproveSettings | null> {
  if (!circleId) return null;
  const { data, error } = await supabase
    .from('circles')
    .select('settings')
    .eq('id', circleId)
    .maybeSingle();
  if (error || !data) return null;
  const settings = (data.settings as any) || {};
  const block = settings.autoApprove;
  return isValidSettings(block) ? block : null;
}

export async function writeCircleAutoApprove(
  circleId: string,
  category: AutoApproveCategory,
  decision: AutoApproveDecision,
): Promise<{ ok: boolean; error?: string }> {
  if (!circleId) return { ok: false, error: 'missing circleId' };
  const existing = (await readCircleAutoApprove(circleId)) || {};
  const next: AutoApproveSettings = { ...existing, [category]: decision };
  const { data: current, error: readErr } = await supabase
    .from('circles')
    .select('settings')
    .eq('id', circleId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  const mergedSettings = { ...(current?.settings as any || {}), autoApprove: next };
  const { error: updateErr } = await supabase
    .from('circles')
    .update({ settings: mergedSettings })
    .eq('id', circleId);
  if (updateErr) return { ok: false, error: updateErr.message };
  return { ok: true };
}

// ─── User-scoped read/write ────────────────────────────────────────────────
//
// Stored in `profiles.office_preferences.autoApprove` (JSONB column on
// profiles, keyed by `profiles.id` = user id). user_memory was the wrong home:
// it has no `prefs` column and is UNIQUE(user_id, circle_id), so a user-keyed
// `.maybeSingle()` / `onConflict: 'user_id'` upsert there errored for any user
// active in a circle (and `content` is NOT NULL). We reuse the existing
// office_preferences blob with the same read-merge-update pattern as
// workspaceAdaptation / onboardingSteps, so no migration is needed.

export async function readUserAutoApprove(userId: string): Promise<AutoApproveSettings | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('office_preferences')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const prefs = (data.office_preferences as any) || {};
  const block = prefs.autoApprove;
  return isValidSettings(block) ? block : null;
}

export async function writeUserAutoApprove(
  userId: string,
  category: AutoApproveCategory,
  decision: AutoApproveDecision,
): Promise<{ ok: boolean; error?: string }> {
  if (!userId) return { ok: false, error: 'missing userId' };
  // Read-merge-update so we never clobber other office_preferences keys
  // (adaptiveWorkspace, onboarding flags, budget/idle config, …).
  const { data: current, error: readErr } = await supabase
    .from('profiles')
    .select('office_preferences')
    .eq('id', userId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  const prefs = (current?.office_preferences as any) || {};
  const existing = (prefs.autoApprove as AutoApproveSettings | undefined) || {};
  const next = { ...existing, [category]: decision };
  const mergedPrefs = { ...prefs, autoApprove: next };
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ office_preferences: mergedPrefs })
    .eq('id', userId);
  if (updateErr) return { ok: false, error: updateErr.message };
  return { ok: true };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isValidSettings(block: any): block is AutoApproveSettings {
  if (!block || typeof block !== 'object') return false;
  for (const value of Object.values(block)) {
    if (value !== 'ask' && value !== 'auto' && value !== 'never') return false;
  }
  return true;
}

export const AUTO_APPROVE_CATEGORY_LABELS: Record<AutoApproveCategory, string> = {
  memory_read: 'Memory: read & list',
  memory_write: 'Memory: save & forget',
  skill_run: 'Skills: run',
  skill_write: 'Skills: import & edit',
  automation_create: 'Automations: create',
  automation_run: 'Automations: run',
  browser_click: 'Browser actions',
  external_publish: 'External publish (WordPress, governance)',
  desktop_action: 'Desktop apps (launch / type / keys)',
};
