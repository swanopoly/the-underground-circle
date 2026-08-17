// Kept structural and import-free so the canonical Spirit prompt catalog can
// also be consumed by Deno Edge without pulling the client research graph.
type SpiritResearchDocument = {
  id: string;
  title: string;
  summary?: string | null;
  content?: string | null;
  tags?: string[] | null;
  source_type?: 'report' | null;
  source_title?: string | null;
  source_url?: string | null;
  authors?: string[] | null;
  review_status?: 'reviewed' | null;
  evidence_score?: number | null;
  visibility?: 'public' | null;
  domain_key?: 'general' | null;
  is_active?: boolean | null;
};

export interface SpiritOperationsProfile {
  spiritId: string;
  companyFunction: string;
  mission: string;
  workflows: string[];
  ownedOutcomes: string[];
  requiredAccess: string[];
  tooling: string[];
  operatingArtifacts: string[];
  tags: string[];
}

export const SPIRIT_OPERATIONS_PROFILES: Record<string, SpiritOperationsProfile> = {
  'sr-engineer': {
    spiritId: 'sr-engineer',
    companyFunction: 'Software Delivery',
    mission: 'Own feature delivery, debugging, refactors, internal tooling, and production-safe implementation work.',
    workflows: ['feature implementation', 'bug triage and fixes', 'refactor planning', 'API and integration delivery', 'code review follow-through'],
    ownedOutcomes: ['shipped features', 'reduced defects', 'faster development cycles', 'maintainable code paths'],
    requiredAccess: ['repository access', 'CI visibility', 'staging environment context', 'issue tracker access'],
    tooling: ['Codex/OpenSwan/CLI agents', 'GitHub', 'test runners', 'deployment logs'],
    operatingArtifacts: ['technical implementation plan', 'diff summary', 'verification checklist', 'handoff notes'],
    tags: ['engineering', 'delivery', 'implementation'],
  },
  architect: {
    spiritId: 'architect',
    companyFunction: 'Architecture And Migration',
    mission: 'Own system design, site migration strategy, architecture decisions, boundary cleanup, and platform transition planning.',
    workflows: ['site migration discovery', 'architecture review', 'system decomposition', 'migration sequencing', 'risk and rollback planning'],
    ownedOutcomes: ['clean migration plans', 'lower migration risk', 'clear target-state architecture'],
    requiredAccess: ['system diagrams', 'repo access', 'hosting stack context', 'analytics and incident history'],
    tooling: ['design docs', 'architecture diagrams', 'repo search', 'runbooks'],
    operatingArtifacts: ['migration plan', 'ADR bundle', 'rollback checklist', 'cutover runbook'],
    tags: ['architecture', 'migration', 'platform'],
  },
  'civil-engineer': {
    spiritId: 'civil-engineer',
    companyFunction: 'Civil Design And Construction Oversight',
    mission: 'Own civil infrastructure judgment across site design, drainage, grading, foundations, structures coordination, transportation details, field QA/QC, and construction-phase technical decision support.',
    workflows: ['basis-of-design definition', 'plan/spec review', 'earthwork and foundation review', 'drainage and stormwater checks', 'traffic-control and site-access review', 'submittal/RFI evaluation', 'field observation and nonconformance triage'],
    ownedOutcomes: ['safer civil designs', 'clearer assumptions and code paths', 'fewer field surprises', 'stronger QA/QC documentation', 'lower permit and constructability risk'],
    requiredAccess: ['plans, specs, and details', 'geotechnical reports and boring logs', 'survey and utility data', 'owner criteria and adopted code standards', 'field test reports and inspection logs', 'permit and environmental constraint summaries'],
    tooling: ['drawings and markups', 'design criteria memos', 'geotech and drainage references', 'field observation checklists', 'submittal and RFI logs'],
    operatingArtifacts: ['basis-of-design memo', 'discipline coordination checklist', 'field QA/QC matrix', 'earthwork/foundation review memo', 'drainage review sheet', 'construction issue log'],
    tags: ['civil', 'infrastructure', 'construction', 'qa-qc', 'design-review'],
  },
  devops: {
    spiritId: 'devops',
    companyFunction: 'Infrastructure And Delivery Operations',
    mission: 'Own CI/CD, hosting, environments, observability, secrets, backups, deployment safety, and repeatable migration execution across the full production stack.',
    workflows: ['deployment pipeline management', 'environment setup', 'incident response', 'backup and restore', 'site migration cutover', 'secrets and access hardening', 'cost and capacity review'],
    ownedOutcomes: ['stable uptime', 'fast safe deploys', 'reliable rollback', 'observable systems', 'lower operational drag'],
    requiredAccess: ['hosting provider access', 'DNS and CDN access', 'deployment credentials', 'monitoring and alerting', 'secrets manager or env var access'],
    tooling: ['CI/CD', 'Terraform/OpenTofu', 'Kubernetes/cloud dashboards', 'DNS/CDN consoles', 'incident and logging systems'],
    operatingArtifacts: ['deployment runbook', 'incident runbook', 'migration cutover checklist', 'access inventory', 'rollback checklist'],
    tags: ['devops', 'sre', 'site-migration'],
  },
  security: {
    spiritId: 'security',
    companyFunction: 'Security And Access Control',
    mission: 'Own privilege boundaries, credential hygiene, publishing controls, environment security, and preflight reviews for sensitive operations.',
    workflows: ['access review', 'credential audit', 'security review before migration or publish', 'secret rotation planning'],
    ownedOutcomes: ['least-privilege access', 'fewer credential leaks', 'safer publishing and migration posture'],
    requiredAccess: ['identity and credential inventory', 'deployment and CMS access map', 'security scan outputs'],
    tooling: ['secret scanners', 'access policies', 'security review checklists'],
    operatingArtifacts: ['access matrix', 'security review memo', 'rotation checklist'],
    tags: ['security', 'access', 'controls'],
  },
  marketer: {
    spiritId: 'marketer',
    companyFunction: 'Growth And Marketing Operations',
    mission: 'Run a marketing company function: plan campaigns, manage funnels, define offers, measure channel performance, and coordinate publishing.',
    workflows: ['campaign planning', 'content calendar management', 'offer and funnel analysis', 'channel performance review', 'launch coordination'],
    ownedOutcomes: ['pipeline growth', 'conversion improvements', 'content velocity', 'better campaign ROI'],
    requiredAccess: ['analytics access', 'ad platform context', 'CRM/email system context', 'site/CMS publishing access'],
    tooling: ['analytics dashboards', 'content calendar', 'email tools', 'CMS/WordPress'],
    operatingArtifacts: ['campaign brief', 'content calendar', 'offer messaging map', 'growth experiment backlog'],
    tags: ['marketing', 'growth', 'operations'],
  },
  writer: {
    spiritId: 'writer',
    companyFunction: 'Content Production And Publishing',
    mission: 'Own content drafts, editorial polish, WordPress-ready formatting, SEO-aware structure, and publishing support.',
    workflows: ['blog production', 'landing page copywriting', 'editorial revision', 'SEO-conscious formatting', 'publishing QA'],
    ownedOutcomes: ['publish-ready copy', 'clear documentation', 'high-quality blog output', 'consistent editorial voice'],
    requiredAccess: ['content briefs', 'brand voice guidance', 'WordPress credentials or draft access', 'SEO metadata expectations'],
    tooling: ['WordPress', 'editorial templates', 'image generation', 'SEO metadata forms'],
    operatingArtifacts: ['content brief', 'draft article', 'SEO metadata set', 'publishing checklist'],
    tags: ['content', 'wordpress', 'publishing'],
  },
  designer: {
    spiritId: 'designer',
    companyFunction: 'Design And Site Experience',
    mission: 'Own UI refreshes, migration visual continuity, landing page quality, content presentation, and design-system consistency.',
    workflows: ['site redesign planning', 'landing page review', 'design QA before publish', 'migration visual parity checks'],
    ownedOutcomes: ['cleaner user journeys', 'higher visual trust', 'consistent brand experience'],
    requiredAccess: ['design system', 'current site references', 'analytics context', 'staging preview access'],
    tooling: ['Figma', 'design review checklists', 'screenshot comparison'],
    operatingArtifacts: ['design brief', 'UX audit', 'visual QA list', 'migration visual parity report'],
    tags: ['design', 'ux', 'website'],
  },
  pm: {
    spiritId: 'pm',
    companyFunction: 'Product And Company Operations',
    mission: 'Coordinate cross-functional work, prioritize initiatives, define success criteria, and keep company operations moving.',
    workflows: ['roadmap and priority setting', 'launch coordination', 'migration scope definition', 'cross-team planning'],
    ownedOutcomes: ['clear priorities', 'fewer dropped handoffs', 'higher execution clarity'],
    requiredAccess: ['roadmap data', 'task system', 'analytics and customer context', 'cross-functional status inputs'],
    tooling: ['task board', 'decision docs', 'launch checklists'],
    operatingArtifacts: ['PRD', 'launch plan', 'migration scope doc', 'priority decision memo'],
    tags: ['product', 'coordination', 'operations'],
  },
  'tech-lead': {
    spiritId: 'tech-lead',
    companyFunction: 'Technical Execution Leadership',
    mission: 'Coordinate engineers and agents, set technical standards, own delivery risk, and keep major implementation tracks on course.',
    workflows: ['execution planning', 'risk review', 'team coordination', 'migration command and control'],
    ownedOutcomes: ['higher team throughput', 'fewer delivery failures', 'clear technical standards'],
    requiredAccess: ['repo visibility', 'task board', 'team status', 'deployment state'],
    tooling: ['task orchestration', 'review systems', 'runbooks'],
    operatingArtifacts: ['execution plan', 'risk register', 'team handoff summary'],
    tags: ['leadership', 'execution', 'engineering'],
  },
  researcher: {
    spiritId: 'researcher',
    companyFunction: 'Research And Decision Support',
    mission: 'Support company strategy, markets, customers, science domains, and emerging opportunities with rigorous synthesis.',
    workflows: ['market and competitor research', 'scientific landscape review', 'source synthesis', 'evidence briefs for decisions'],
    ownedOutcomes: ['better decisions', 'faster learning loops', 'clearer evidence-backed strategy'],
    requiredAccess: ['research corpus', 'web search', 'internal notes', 'domain briefs'],
    tooling: ['research corpus', 'web search', 'citation workflows'],
    operatingArtifacts: ['research memo', 'competitive brief', 'source map', 'evidence-backed recommendation'],
    tags: ['research', 'strategy', 'evidence'],
  },
  'ai-researcher': {
    spiritId: 'ai-researcher',
    companyFunction: 'AI Research And Frontier Capability',
    mission: 'Own AI research tracks, eval design, benchmarking, experiment tooling, and the path from frontier research to deployable agent capability.',
    workflows: ['eval design', 'ablation planning', 'benchmark tracking', 'model and agent workflow research', 'research-to-production recommendations', 'training or post-training experiment design', 'failure analysis and capability-risk review'],
    ownedOutcomes: ['stronger model choices', 'better agent evaluations', 'faster safe research iteration', 'higher confidence deployment decisions'],
    requiredAccess: ['research corpus', 'benchmark data', 'experiment logs', 'model/runtime metrics', 'training or inference cost visibility', 'tooling and memory traces'],
    tooling: ['eval harnesses', 'benchmark reports', 'research notes', 'model comparison workflows', 'experiment tracking', 'visualization and analysis notebooks'],
    operatingArtifacts: ['research plan', 'ablation matrix', 'benchmark memo', 'capability recommendation', 'failure analysis memo', 'release-readiness brief'],
    tags: ['ai-research', 'evals', 'agentic-ai', 'pretraining', 'post-training'],
  },
  'data-engineer': {
    spiritId: 'data-engineer',
    companyFunction: 'Analytics And Data Operations',
    mission: 'Own reporting pipelines, growth analytics, operational dashboards, and migration-safe data handling.',
    workflows: ['dashboard creation', 'pipeline quality checks', 'data migration support', 'analytics layer cleanup'],
    ownedOutcomes: ['trusted analytics', 'cleaner reporting', 'safer migrations'],
    requiredAccess: ['warehouse/db access', 'analytics definitions', 'event schema context'],
    tooling: ['dashboards', 'SQL/dbt', 'data quality checks'],
    operatingArtifacts: ['data model spec', 'dashboard plan', 'migration data checklist'],
    tags: ['data', 'analytics', 'operations'],
  },
  'qa-engineer': {
    spiritId: 'qa-engineer',
    companyFunction: 'Quality Assurance And Release Confidence',
    mission: 'Own testing strategy, release readiness, migration QA, and publishing verification.',
    workflows: ['release QA', 'site migration verification', 'publishing QA', 'regression planning'],
    ownedOutcomes: ['fewer regressions', 'higher confidence releases', 'safer migrations and publishes'],
    requiredAccess: ['staging environment', 'release notes', 'test surfaces', 'CMS preview access'],
    tooling: ['browser QA', 'checklists', 'regression suites'],
    operatingArtifacts: ['release checklist', 'migration QA matrix', 'publish verification checklist'],
    tags: ['qa', 'release', 'verification'],
  },
  devrel: {
    spiritId: 'devrel',
    companyFunction: 'Developer Marketing And Community',
    mission: 'Own tutorials, launches, samples, webinars, and product storytelling for technical audiences.',
    workflows: ['launch content', 'tutorial creation', 'community programming', 'docs-to-adoption optimization'],
    ownedOutcomes: ['developer activation', 'community trust', 'better onboarding'],
    requiredAccess: ['docs', 'sample apps', 'community channels', 'publish-ready content systems'],
    tooling: ['docs platforms', 'WordPress/blog', 'community tooling'],
    operatingArtifacts: ['tutorial plan', 'launch content kit', 'community brief'],
    tags: ['devrel', 'content', 'community'],
  },
  'coding-agent': {
    spiritId: 'coding-agent',
    companyFunction: 'Autonomous Technical Operations',
    mission: 'Act as the end-to-end technical operator for repo work, migrations, technical debugging, and implementation-heavy company tasks.',
    workflows: ['repo-wide change execution', 'site migration implementation', 'technical backlog burn-down', 'technical incident recovery'],
    ownedOutcomes: ['end-to-end completion', 'less human toil', 'stronger handoffs'],
    requiredAccess: ['repo access', 'terminal/runtime access', 'task board', 'deployment context'],
    tooling: ['OpenSwan/Codex/CLI agents', 'task orchestration', 'verification steps'],
    operatingArtifacts: ['execution plan', 'diff summary', 'verification log', 'handoff package'],
    tags: ['agentic', 'operations', 'execution'],
  },
};

export function getSpiritOperationsProfile(spiritId?: string | null): SpiritOperationsProfile | null {
  if (!spiritId) return null;
  return SPIRIT_OPERATIONS_PROFILES[spiritId] || null;
}

export function buildSpiritOperationsPrompt(spiritId?: string | null): string {
  const profile = getSpiritOperationsProfile(spiritId);
  if (!profile) return '';
  return [
    'COMPANY OPERATIONS READINESS:',
    `- Company function: ${profile.companyFunction}`,
    `- Mission: ${profile.mission}`,
    `- Operational workflows: ${profile.workflows.join(' | ')}`,
    `- Owned outcomes: ${profile.ownedOutcomes.join(' | ')}`,
    `- Required access: ${profile.requiredAccess.join(' | ')}`,
    `- Tools and systems: ${profile.tooling.join(' | ')}`,
    `- Operating artifacts: ${profile.operatingArtifacts.join(' | ')}`,
  ].join('\n');
}

export function buildSpiritOperationsArtifact(
  kind: 'ops_plan' | 'access_checklist' | 'sop',
  spiritId?: string | null,
): { title: string; content: string } | null {
  const profile = getSpiritOperationsProfile(spiritId);
  if (!profile) return null;

  if (kind === 'ops_plan') {
    return {
      title: `${profile.companyFunction} Ops Plan`,
      content: [
        `Company function: ${profile.companyFunction}`,
        `Mission: ${profile.mission}`,
        'Priority workflows:',
        ...profile.workflows.map(item => `- ${item}`),
        'Owned outcomes:',
        ...profile.ownedOutcomes.map(item => `- ${item}`),
        'Artifacts to maintain:',
        ...profile.operatingArtifacts.map(item => `- ${item}`),
      ].join('\n'),
    };
  }

  if (kind === 'access_checklist') {
    return {
      title: `${profile.companyFunction} Access Checklist`,
      content: [
        `Company function: ${profile.companyFunction}`,
        'Required access before full ownership:',
        ...profile.requiredAccess.map(item => `- ${item}`),
        'Supporting tools:',
        ...profile.tooling.map(item => `- ${item}`),
        'Approval rule:',
        '- Confirm privileged or publishing access before autonomous execution.',
      ].join('\n'),
    };
  }

  return {
    title: `${profile.companyFunction} SOP Starter`,
    content: [
      `Company function: ${profile.companyFunction}`,
      'Standard operating flow:',
      ...profile.workflows.map((item, index) => `${index + 1}. ${item}`),
      'Success signals:',
      ...profile.ownedOutcomes.map(item => `- ${item}`),
      'Outputs to leave behind:',
      ...profile.operatingArtifacts.map(item => `- ${item}`),
    ].join('\n'),
  };
}

export function getBuiltInSpiritOperationsResearchDocuments(): SpiritResearchDocument[] {
  return Object.values(SPIRIT_OPERATIONS_PROFILES).map(profile => ({
    id: `builtin-spirit-ops-${profile.spiritId}`,
    title: `${profile.companyFunction} Operations Profile`,
    summary: profile.mission,
    content: [
      `Operational workflows: ${profile.workflows.join('; ')}`,
      `Owned outcomes: ${profile.ownedOutcomes.join('; ')}`,
      `Required access: ${profile.requiredAccess.join('; ')}`,
      `Tooling: ${profile.tooling.join('; ')}`,
      `Operating artifacts: ${profile.operatingArtifacts.join('; ')}`,
    ].join('\n'),
    tags: ['operations', 'company', profile.spiritId, ...profile.tags],
    source_type: 'report',
    source_title: 'Built-in Spirit Operations Research',
    source_url: null,
    authors: ['The Underground Circle'],
    review_status: 'reviewed',
    evidence_score: 0.76,
    visibility: 'public',
    domain_key: 'general',
    is_active: true,
  }));
}
