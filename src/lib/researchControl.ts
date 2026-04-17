import { supabase } from './supabase';
import { getLatestResearchDigests, getResearchDocuments, type ResearchDocument } from './researchKnowledge';

export interface ResearchDocumentReference {
  id: string;
  title: string;
  subtitle: string;
  reviewStatus: 'draft' | 'reviewed' | 'validated' | 'unknown';
  color: string;
  profileKey?: string | null;
  sourceType?: string | null;
  relevantSpirits: string[];
}

function getResearchReferenceColor(reviewStatus: ResearchDocumentReference['reviewStatus']): string {
  switch (reviewStatus) {
    case 'validated':
      return '#22c55e';
    case 'reviewed':
      return '#38bdf8';
    case 'draft':
      return '#f59e0b';
    default:
      return '#94a3b8';
  }
}

function mapResearchDocumentReference(doc: ResearchDocument): ResearchDocumentReference {
  const metadata = (doc.metadata || {}) as {
    profile_key?: string;
    relevant_spirits?: unknown;
  };
  const relevantSpirits = Array.isArray(metadata.relevant_spirits)
    ? metadata.relevant_spirits.filter((value): value is string => typeof value === 'string')
    : [];
  const reviewStatus = doc.review_status || 'unknown';

  return {
    id: doc.id,
    title: doc.title,
    subtitle: doc.summary || doc.source_title || doc.source_type || 'Research document',
    reviewStatus,
    color: getResearchReferenceColor(reviewStatus),
    profileKey: metadata.profile_key || null,
    sourceType: doc.source_type || null,
    relevantSpirits,
  };
}

export interface ResearchAgentRun {
  id: string;
  profile_key: string;
  source: string;
  status: 'running' | 'succeeded' | 'failed';
  run_date: string;
  query?: string | null;
  target_spirits?: string[] | null;
  documents_created?: number | null;
  summary?: Record<string, unknown> | null;
  error?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
}

export function getResearchDocumentRelevantSpirits(doc: ResearchDocument): string[] {
  const metadata = (doc.metadata || {}) as { relevant_spirits?: unknown };
  return Array.isArray(metadata.relevant_spirits)
    ? metadata.relevant_spirits.filter((item): item is string => typeof item === 'string')
    : [];
}

export async function getResearchAgentRuns(limit = 20): Promise<ResearchAgentRun[]> {
  try {
    const { data, error } = await supabase
      .from('research_agent_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as ResearchAgentRun[];
  } catch {
    return [];
  }
}

export async function getResearchAgentRunById(runId: string): Promise<ResearchAgentRun | null> {
  try {
    const { data, error } = await supabase
      .from('research_agent_runs')
      .select('*')
      .eq('id', runId)
      .single();
    if (error || !data) return null;
    return data as ResearchAgentRun;
  } catch {
    return null;
  }
}

export async function getGeneratedResearchDigests(limit = 12): Promise<ResearchDocument[]> {
  try {
    const { data, error } = await supabase
      .from('research_documents')
      .select('*')
      .eq('is_active', true)
      .eq('source_type', 'report')
      .contains('tags', ['daily-research-digest'])
      .order('publication_date', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as ResearchDocument[];
  } catch {
    return [];
  }
}

export async function getGeneratedResearchBriefs(limit = 20): Promise<ResearchDocument[]> {
  try {
    const { data, error } = await supabase
      .from('research_documents')
      .select('*')
      .eq('is_active', true)
      .eq('source_type', 'paper')
      .eq('source_title', 'arXiv')
      .order('publication_date', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as ResearchDocument[];
  } catch {
    return [];
  }
}

export async function getResearchDocumentById(documentId: string): Promise<ResearchDocument | null> {
  try {
    const { data, error } = await supabase
      .from('research_documents')
      .select('*')
      .eq('id', documentId)
      .single();
    if (error || !data) return null;
    return data as ResearchDocument;
  } catch {
    return null;
  }
}

export async function getRelatedResearchDocuments(opts: {
  document: ResearchDocument;
  limit?: number;
}): Promise<ResearchDocumentReference[]> {
  const limit = Math.max(1, Math.min(opts.limit || 4, 8));
  const query = [
    opts.document.title,
    opts.document.summary || '',
    ...(opts.document.tags || []),
    ...getResearchDocumentRelevantSpirits(opts.document),
  ].join(' ');

  try {
    const docs = await getResearchDocuments({
      query,
      circleId: opts.document.circle_id || undefined,
      limit: limit + 2,
    });
    return docs
      .filter((doc) => doc.id !== opts.document.id)
      .slice(0, limit)
      .map(mapResearchDocumentReference);
  } catch {
    return [];
  }
}

export async function getResearchDocumentReferences(opts: {
  query: string;
  circleId?: string;
  spiritId?: string | null;
  limit?: number;
}): Promise<ResearchDocumentReference[]> {
  const limit = Math.max(1, Math.min(opts.limit || 3, 6));
  try {
    const [rankedDocs, latestDigests] = await Promise.all([
      getResearchDocuments({
        query: opts.query,
        circleId: opts.circleId,
        spiritId: opts.spiritId,
        limit,
      }),
      getLatestResearchDigests({
        circleId: opts.circleId,
        spiritId: opts.spiritId,
        limit: 2,
      }),
    ]);

    const merged: ResearchDocument[] = [];
    const seen = new Set<string>();
    for (const doc of [...latestDigests, ...rankedDocs]) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      merged.push(doc);
      if (merged.length >= limit) break;
    }

    return merged.map(mapResearchDocumentReference);
  } catch {
    return [];
  }
}

export async function getLatestSpiritResearchReferences(opts: {
  spiritId?: string | null;
  circleId?: string;
  limit?: number;
}): Promise<ResearchDocumentReference[]> {
  if (!opts.spiritId) return [];
  try {
    const docs = await getLatestResearchDigests({
      spiritId: opts.spiritId,
      circleId: opts.circleId,
      limit: opts.limit || 3,
    });
    return docs.map(mapResearchDocumentReference);
  } catch {
    return [];
  }
}

export async function runResearchProfile(profileKey: string): Promise<{ ok: boolean; error?: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('research-daily-runner', {
      body: {
        source: 'manual_ui',
        profiles: [profileKey],
      },
    });
    if (error) return { ok: false, error: error.message };
    if (data?.ok === false) return { ok: false, error: data?.error || 'Run failed' };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setResearchDocumentReviewStatus(
  documentId: string,
  reviewStatus: 'draft' | 'reviewed' | 'validated',
): Promise<{ ok: boolean; error?: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke('research-daily-runner', {
      body: {
        action: 'set_review_status',
        documentId,
        reviewStatus,
      },
    });
    if (error) return { ok: false, error: error.message };
    if (data?.ok === false) return { ok: false, error: data?.error || 'Update failed' };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
