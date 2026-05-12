import { supabase } from './supabase';
import {
  coerceBusinessModelProfiles,
  type BusinessModelProfile,
} from './businessModelProfileCore';

export {
  buildImplicitBusinessModelProfiles,
  coerceBusinessModelProfiles,
  formatBusinessModelTaskBlock,
  planBusinessModelForComputerTask,
  surfaceForComputerTask,
  DEFAULT_BUSINESS_MODEL_GOVERNANCE,
} from './businessModelProfileCore';

export type {
  BusinessModelProfile,
  BusinessModelTaskPlan,
  BusinessRiskLevel,
  BusinessTaskSurface,
} from './businessModelProfileCore';

const SETTINGS_KEY = 'businessModelProfiles';

export async function loadCircleBusinessModelProfiles(circleId: string): Promise<BusinessModelProfile[]> {
  if (!circleId) return [];
  const { data, error } = await supabase
    .from('circles')
    .select('settings')
    .eq('id', circleId)
    .maybeSingle();
  if (error || !data) return [];
  return coerceBusinessModelProfiles((data.settings as any)?.[SETTINGS_KEY]);
}

export async function saveCircleBusinessModelProfiles(
  circleId: string,
  profiles: BusinessModelProfile[],
): Promise<{ ok: boolean; error?: string }> {
  if (!circleId) return { ok: false, error: 'missing circleId' };
  const { data, error: readErr } = await supabase
    .from('circles')
    .select('settings')
    .eq('id', circleId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  const merged = {
    ...(data?.settings as any || {}),
    [SETTINGS_KEY]: coerceBusinessModelProfiles(profiles),
  };
  const { error } = await supabase.from('circles').update({ settings: merged }).eq('id', circleId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
