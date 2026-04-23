import { supabase } from './supabase';
export { buildRunMetadataSummaryProps, type RunMetadataSummaryProps as TaskRunMetadataSummaryProps } from './runMetadataSummary';

export async function fetchTaskRunMetadataByOpenSwanRunId(
  openSwanRunIds: Array<string | null | undefined>,
): Promise<Record<string, Record<string, any>>> {
  const ids = Array.from(new Set(
    openSwanRunIds.filter((value): value is string => typeof value === 'string' && value.length > 0),
  ));
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('agent_runs')
    .select('id, metadata')
    .in('id', ids);
  if (error || !data) return {};
  return Object.fromEntries(data.map((run: any) => [run.id, run.metadata || {}]));
}
