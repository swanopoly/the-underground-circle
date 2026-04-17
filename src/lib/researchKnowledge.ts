import { supabase } from './supabase';
import { buildImpactDomainGuidance, getImpactDomain, inferImpactDomain, type ImpactDomainKey } from './impactDomains';
import { getBuiltInSpiritCareerResearchDocuments, inferSpiritCareerProfiles } from './spiritCareerProfiles';
import { getBuiltInSpiritOperationsResearchDocuments } from './spiritOperationsProfiles';
import { getSpiritById } from './agentSpirits';
import { getBuiltInCivilEngineeringResearchDocuments } from './civilEngineeringKnowledge';

export type ResearchVisibility = 'private' | 'circle_shared' | 'public';
export type ResearchSourceType = 'paper' | 'dataset' | 'guideline' | 'note' | 'report' | 'website';
export type ResearchReviewStatus = 'draft' | 'reviewed' | 'validated';

export interface ResearchDocument {
  id: string;
  circle_id?: string | null;
  title: string;
  summary?: string | null;
  content?: string | null;
  domain_key?: ImpactDomainKey | null;
  tags?: string[] | null;
  source_type?: ResearchSourceType | null;
  source_title?: string | null;
  source_url?: string | null;
  authors?: string[] | null;
  publication_date?: string | null;
  review_status?: ResearchReviewStatus | null;
  evidence_score?: number | null;
  visibility?: ResearchVisibility | null;
  is_active?: boolean | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

function splitTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2)
    .slice(0, 24);
}

function scoreResearchDocument(doc: ResearchDocument, query: string, domainKey: ImpactDomainKey): number {
  const qTerms = splitTerms(query);
  const haystack = [
    doc.title,
    doc.summary || '',
    doc.content || '',
    (doc.tags || []).join(' '),
    doc.source_title || '',
    doc.domain_key || '',
  ].join(' ').toLowerCase();

  let score = doc.evidence_score || 0.5;
  const careerQuery = /\b(job|jobs|linkedin|resume|cv|application|interview|hiring|role|position)\b/i.test(query);
  const operationsQuery = /\b(marketing|agency|wordpress|cms|publish|publishing|migration|cutover|operations|runbook|sop|access|permissions|website|launch|campaign)\b/i.test(query);
  if (doc.domain_key && doc.domain_key === domainKey) score += 2.2;
  if (doc.review_status === 'validated') score += 1.5;
  else if (doc.review_status === 'reviewed') score += 0.8;
  if (doc.id?.startsWith('builtin-spirit-career-')) score += 0.25;
  if (doc.id?.startsWith('builtin-spirit-ops-')) score += 0.35;
  if (careerQuery && doc.id?.startsWith('builtin-spirit-career-')) score += 3.4;
  if (operationsQuery && doc.id?.startsWith('builtin-spirit-ops-')) score += 3.8;

  for (const term of qTerms) {
    if (haystack.includes(term)) score += term.length > 7 ? 1.3 : 0.8;
  }

  const matchingSpiritProfiles = inferSpiritCareerProfiles(query, 3);
  if (matchingSpiritProfiles.some(profile => doc.tags?.includes(profile.spiritId))) {
    score += 2.4;
  }

  if (doc.publication_date) {
    const ageDays = (Date.now() - new Date(doc.publication_date).getTime()) / 86_400_000;
    if (Number.isFinite(ageDays)) score *= Math.max(0.65, 1 - ageDays * 0.0004);
  }

  return score;
}

function getRelevantSpiritIds(doc: ResearchDocument): string[] {
  const metadata = doc.metadata as { relevant_spirits?: unknown } | undefined;
  const relevantSpirits = Array.isArray(metadata?.relevant_spirits)
    ? metadata!.relevant_spirits.filter((item): item is string => typeof item === 'string')
    : [];
  return relevantSpirits;
}

function uniqueResearchDocuments(docs: ResearchDocument[]): ResearchDocument[] {
  const seen = new Set<string>();
  const next: ResearchDocument[] = [];
  for (const doc of docs) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    next.push(doc);
  }
  return next;
}

export async function getResearchDocuments(opts: {
  query?: string;
  circleId?: string;
  domainKey?: ImpactDomainKey;
  spiritId?: string | null;
  limit?: number;
}): Promise<ResearchDocument[]> {
  try {
    const builtins = [
      ...getBuiltInSpiritCareerResearchDocuments(),
      ...getBuiltInSpiritOperationsResearchDocuments(),
      ...getBuiltInCivilEngineeringResearchDocuments(),
    ];
    let query = supabase
      .from('research_documents')
      .select('*')
      .eq('is_active', true)
      .in('visibility', ['circle_shared', 'public'])
      .limit(Math.max((opts.limit || 6) * 4, 12));

    if (opts.circleId) {
      query = query.or(`circle_id.eq.${opts.circleId},circle_id.is.null`);
    } else {
      query = query.is('circle_id', null);
    }

    const { data, error } = await query;
    const persisted = error || !data ? [] : data as ResearchDocument[];

    const domainKey = opts.domainKey || inferImpactDomain({ query: opts.query || '' });
    const spirit = opts.spiritId ? getSpiritById(opts.spiritId) : null;
    const ranked = [...persisted, ...builtins]
      .filter(doc => !opts.domainKey || !doc.domain_key || doc.domain_key === opts.domainKey)
      .map(doc => {
        let score = scoreResearchDocument(doc, opts.query || '', domainKey);
        const relevantSpiritIds = getRelevantSpiritIds(doc);
        if (opts.spiritId && relevantSpiritIds.includes(opts.spiritId)) score += 4.2;
        if (opts.spiritId && doc.tags?.includes(opts.spiritId)) score += 2.4;
        if (spirit && doc.tags?.includes(spirit.skillBundle)) score += 1.8;
        return { doc, score };
      })
      .filter(item => item.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit || 6)
      .map(item => item.doc);

    return ranked;
  } catch {
    return [];
  }
}

export async function buildResearchKnowledgeBundle(opts: {
  query: string;
  circleId?: string;
  spiritId?: string | null;
  limit?: number;
}): Promise<string> {
  const domainKey = inferImpactDomain({ query: opts.query });
  const domain = getImpactDomain(domainKey);
  const docs = await getResearchDocuments({
    query: opts.query,
    circleId: opts.circleId,
    domainKey,
    spiritId: opts.spiritId,
    limit: opts.limit || 4,
  });

  const domainGuidance = buildImpactDomainGuidance({ query: opts.query, domainKey });
  if (docs.length === 0) {
    return domainGuidance
      ? `${domainGuidance}\nNo curated research corpus match found yet for this query.`
      : '';
  }

  const lines = docs.map(doc => {
    const refs = [
      doc.source_title || doc.source_type || 'source',
      doc.source_url ? `URL: ${doc.source_url}` : '',
      doc.review_status ? `Review: ${doc.review_status}` : '',
      doc.evidence_score != null ? `Evidence score: ${doc.evidence_score}` : '',
    ].filter(Boolean).join(' | ');

    return [
      `- ${doc.title}${doc.domain_key ? ` [${doc.domain_key}]` : ''}`,
      doc.summary ? `  Summary: ${doc.summary}` : '',
      refs ? `  Source: ${refs}` : '',
      doc.tags && doc.tags.length > 0 ? `  Tags: ${doc.tags.slice(0, 6).join(', ')}` : '',
      doc.content ? `  Excerpt: ${doc.content.slice(0, 280)}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return [
    domainGuidance,
    `=== CURATED RESEARCH CORPUS ===`,
    `Domain: ${domain.label}`,
    lines,
  ].filter(Boolean).join('\n');
}

export async function buildSpiritResearchKnowledgeBundle(opts: {
  query: string;
  circleId?: string;
  spiritId?: string | null;
  limit?: number;
}): Promise<string> {
  if (!opts.spiritId) return '';
  const spirit = getSpiritById(opts.spiritId);
  const docs = await getResearchDocuments({
    query: opts.query,
    circleId: opts.circleId,
    spiritId: opts.spiritId,
    limit: opts.limit || 4,
  });

  const latestDigests = await getLatestResearchDigests({
    spiritId: opts.spiritId,
    circleId: opts.circleId,
    limit: 2,
  });

  const mergedDocs = uniqueResearchDocuments([...latestDigests, ...docs]).slice(0, opts.limit || 4);

  if (mergedDocs.length === 0) return '';

  const lines = mergedDocs.map(doc => {
    const refs = [
      doc.source_title || doc.source_type || 'source',
      doc.source_url ? `URL: ${doc.source_url}` : '',
      doc.review_status ? `Review: ${doc.review_status}` : '',
      doc.evidence_score != null ? `Evidence score: ${doc.evidence_score}` : '',
    ].filter(Boolean).join(' | ');
    return [
      `- ${doc.title}${doc.domain_key ? ` [${doc.domain_key}]` : ''}`,
      doc.summary ? `  Summary: ${doc.summary}` : '',
      refs ? `  Source: ${refs}` : '',
      doc.tags && doc.tags.length > 0 ? `  Tags: ${doc.tags.slice(0, 8).join(', ')}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return [
    `=== SPIRIT RESEARCH INFUSION: ${spirit?.name || opts.spiritId} ===`,
    lines,
  ].join('\n');
}

export async function getLatestResearchDigests(opts: {
  spiritId?: string | null;
  circleId?: string;
  limit?: number;
}): Promise<ResearchDocument[]> {
  try {
    let query = supabase
      .from('research_documents')
      .select('*')
      .eq('is_active', true)
      .eq('source_type', 'report')
      .contains('tags', ['daily-research-digest'])
      .order('publication_date', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(opts.limit || 3);

    if (opts.circleId) {
      query = query.or(`circle_id.eq.${opts.circleId},circle_id.is.null`);
    } else {
      query = query.is('circle_id', null);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    const docs = data as ResearchDocument[];
    if (!opts.spiritId) return docs;
    return docs.filter(doc => {
      const relevantSpiritIds = getRelevantSpiritIds(doc);
      return relevantSpiritIds.includes(opts.spiritId!) || !!doc.tags?.includes(opts.spiritId!);
    });
  } catch {
    return [];
  }
}

export async function buildResearchSearchResponse(opts: {
  query: string;
  circleId?: string;
  limit?: number;
}): Promise<string> {
  const docs = await getResearchDocuments({
    query: opts.query,
    circleId: opts.circleId,
    limit: opts.limit || 5,
  });

  if (docs.length === 0) {
    const domain = getImpactDomain(inferImpactDomain({ query: opts.query }));
    return `**Research Search:** No curated research match for "${opts.query}".\n\nClosest impact domain: **${domain.label}**.`;
  }

  return [
    `**Research Search: "${opts.query}"**`,
    '',
    ...docs.map((doc, index) => [
      `${index + 1}. **${doc.title}**${doc.domain_key ? ` [${doc.domain_key}]` : ''}`,
      doc.summary ? `   ${doc.summary}` : '',
      doc.source_title || doc.source_url ? `   Source: ${doc.source_title || doc.source_url}` : '',
      doc.review_status ? `   Review: ${doc.review_status}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n');
}

export async function saveResearchDocument(opts: {
  circleId?: string;
  title: string;
  summary?: string;
  content?: string;
  domainKey?: ImpactDomainKey;
  tags?: string[];
  sourceType?: ResearchSourceType;
  sourceTitle?: string;
  sourceUrl?: string;
  authors?: string[];
  publicationDate?: string;
  reviewStatus?: ResearchReviewStatus;
  evidenceScore?: number;
  visibility?: ResearchVisibility;
  metadata?: Record<string, unknown>;
}): Promise<ResearchDocument | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;

    const domainKey = opts.domainKey || inferImpactDomain({
      title: opts.title,
      description: `${opts.summary || ''} ${opts.content || ''}`,
    });

    const { data, error } = await supabase
      .from('research_documents')
      .insert({
        circle_id: opts.circleId || null,
        created_by: auth.user.id,
        domain_key: domainKey,
        title: opts.title,
        summary: opts.summary || null,
        content: opts.content || null,
        tags: opts.tags || [],
        source_type: opts.sourceType || 'note',
        source_title: opts.sourceTitle || null,
        source_url: opts.sourceUrl || null,
        authors: opts.authors || [],
        publication_date: opts.publicationDate || null,
        review_status: opts.reviewStatus || 'draft',
        evidence_score: opts.evidenceScore ?? 0.5,
        visibility: opts.visibility || (opts.circleId ? 'circle_shared' : 'private'),
        metadata: opts.metadata || {},
      })
      .select()
      .single();

    return error ? null : data as ResearchDocument;
  } catch {
    return null;
  }
}
