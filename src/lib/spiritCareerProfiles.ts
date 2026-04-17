import type { ResearchDocument } from './researchKnowledge';

export interface SpiritCareerProfile {
  spiritId: string;
  seniorRoleTitle: string;
  marketSummary: string;
  ownershipAreas: string[];
  commonDeliverables: string[];
  applicationArtifacts: string[];
  interviewFocus: string[];
  roleDrills?: string[];
  sourceUrls: string[];
  tags: string[];
}

const DEFAULT_APPLICATION_ARTIFACTS = [
  'tailored resume bullets',
  'targeted cover letter or outreach note',
  'role-relevant portfolio or case studies',
  'interview preparation outline',
];

function linkedinJobSearch(query: string): string {
  return `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}`;
}

function linkedinAdviceSearch(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/advice ${query}`)}`;
}

function officialCareerPage(url: string): string {
  return url;
}

export const SPIRIT_CAREER_PROFILES: Record<string, SpiritCareerProfile> = {
  'sr-engineer': {
    spiritId: 'sr-engineer',
    seniorRoleTitle: 'Senior Software Engineer',
    marketSummary: 'Current senior software roles emphasize end-to-end ownership, technical decision making, code quality, mentoring, and reliable delivery across cross-functional teams.',
    ownershipAreas: ['design and ship complex features', 'review and improve architecture', 'mentor junior engineers', 'drive quality, scalability, and maintainability'],
    commonDeliverables: ['production code', 'technical design docs', 'review feedback', 'incident fixes', 'test coverage improvements'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['system design', 'debugging', 'tradeoff reasoning', 'behavioral ownership stories', 'code quality and mentoring'],
    roleDrills: ['ship a scoped feature end to end', 'debug a production regression under time pressure', 'write a design note with tradeoffs and rollout plan'],
    sourceUrls: [linkedinAdviceSearch('senior software engineer responsibilities LinkedIn advice'), linkedinJobSearch('Senior Software Engineer')],
    tags: ['software-engineering', 'senior-role', 'ownership'],
  },
  architect: {
    spiritId: 'architect',
    seniorRoleTitle: 'Senior Systems Architect',
    marketSummary: 'Senior architecture roles are measured on system boundaries, long-range technical strategy, resilience, platform fit, and the ability to align many teams around coherent tradeoffs.',
    ownershipAreas: ['define architecture standards', 'evaluate tradeoffs under scale and reliability constraints', 'shape migration paths', 'align technical direction across teams'],
    commonDeliverables: ['architecture diagrams', 'ADRs', 'migration plans', 'scalability reviews'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['system decomposition', 'reliability and scaling tradeoffs', 'migration strategy', 'stakeholder influence'],
    sourceUrls: [linkedinJobSearch('Senior Systems Architect'), linkedinAdviceSearch('senior software engineer system design responsibilities')],
    tags: ['architecture', 'systems-design', 'strategy'],
  },
  'civil-engineer': {
    spiritId: 'civil-engineer',
    seniorRoleTitle: 'Senior Civil Engineer',
    marketSummary: 'Senior civil engineering roles are measured on public-safety judgment, code-driven design, field constructability, interdisciplinary coordination, and the ability to turn incomplete site information into defensible decisions across structures, site development, transportation, geotechnical work, drainage, and construction administration.',
    ownershipAreas: ['define governing design criteria and assumptions', 'coordinate across geotechnical, structural, transportation, water, utility, and construction stakeholders', 'review field and lab test data against acceptance criteria', 'protect safety, compliance, and constructability through design and construction phases'],
    commonDeliverables: ['design calculations', 'basis-of-design memos', 'plan/spec review comments', 'stormwater or drainage narratives', 'earthwork and foundation recommendations', 'field observation reports', 'QA/QC punchlists', 'bid/RFI/submittal responses'],
    applicationArtifacts: ['discipline-specific resume bullets', 'project sheet portfolio with drawings/details/photos', 'calculation or technical memo samples when shareable', 'interview preparation outline focused on technical judgment and field decisions'],
    interviewFocus: ['FE/PE licensure trajectory', 'load path and code reasoning', 'geotechnical and earthwork judgment', 'stormwater/drainage logic', 'construction administration and QA/QC', 'risk communication and public-safety decisions'],
    roleDrills: ['review a plan set for life-safety, code, and constructability risks', 'turn boring logs and site constraints into a foundation/earthwork recommendation', 'debug a drainage or grading failure from limited field information', 'write an RFI or field memo that protects the owner and contractor from ambiguity'],
    sourceUrls: [
      officialCareerPage('https://www.asce.org/about-civil-engineering'),
      officialCareerPage('https://ncees.org/exams/fe-exam/'),
      officialCareerPage('https://ncees.org/exams/pe-exam/civil/'),
      linkedinJobSearch('Senior Civil Engineer'),
    ],
    tags: ['civil-engineering', 'senior-role', 'public-safety', 'infrastructure'],
  },
  devops: {
    spiritId: 'devops',
    seniorRoleTitle: 'Senior DevOps Engineer',
    marketSummary: 'Current senior DevOps roles are measured on owning the full delivery substrate: cloud infrastructure, Kubernetes or container orchestration, CI/CD, observability, secrets, reliability engineering, cost discipline, and migration-safe operational execution.',
    ownershipAreas: ['platform reliability and incident ownership', 'CI/CD and GitOps maturity', 'infrastructure as code and environment reproducibility', 'developer self-service, observability, and secure access control'],
    commonDeliverables: ['pipelines', 'Terraform/OpenTofu or CloudFormation changes', 'runbooks', 'observability dashboards', 'postmortems', 'migration cutover and rollback plans', 'access inventories'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['Kubernetes and cloud operations', 'IaC', 'observability', 'incident ownership', 'delivery speed vs reliability tradeoffs', 'site migration and rollback strategy', 'security and secrets posture'],
    roleDrills: ['run a zero-downtime site migration plan', 'debug a failed deployment and restore service safely', 'design CI/CD and secrets flow for a multi-env stack'],
    sourceUrls: [
      linkedinJobSearch('Senior DevOps Engineer Kubernetes Terraform'),
      linkedinAdviceSearch('senior devops engineer responsibilities LinkedIn advice'),
    ],
    tags: ['devops', 'platform', 'sre', 'job-market'],
  },
  security: {
    spiritId: 'security',
    seniorRoleTitle: 'Senior Security Engineer',
    marketSummary: 'Senior security roles increasingly expect practical ownership of secure design, application and infrastructure hardening, threat modeling, and secure delivery gates embedded into engineering workflows.',
    ownershipAreas: ['threat modeling', 'secure architecture and code review', 'identity and access hardening', 'security automation in CI/CD'],
    commonDeliverables: ['threat models', 'security reviews', 'vulnerability remediation plans', 'policy and control recommendations'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['OWASP and auth flaws', 'cloud and secrets management', 'defense in depth', 'risk prioritization'],
    sourceUrls: [linkedinJobSearch('Senior Security Engineer'), linkedinAdviceSearch('senior security engineer responsibilities')],
    tags: ['security-engineering', 'appsec', 'cloud-security'],
  },
  'github-devops': {
    spiritId: 'github-devops',
    seniorRoleTitle: 'Senior CI/CD and GitHub Platform Engineer',
    marketSummary: 'GitHub-heavy platform roles center on workflow design, branch protections, deployment automation, reusable workflows, and developer platform enablement.',
    ownershipAreas: ['workflow architecture', 'deployment automation', 'GitHub governance and security', 'developer enablement'],
    commonDeliverables: ['GitHub Actions workflows', 'release automations', 'security scan integrations', 'branch protection standards'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['workflow design', 'GitHub Actions internals', 'artifact and cache strategies', 'supply-chain security'],
    sourceUrls: [linkedinJobSearch('GitHub Actions CI CD Platform Engineer')],
    tags: ['github-actions', 'cicd', 'platform-engineering'],
  },
  'code-reviewer': {
    spiritId: 'code-reviewer',
    seniorRoleTitle: 'Staff-Level Code Quality Reviewer',
    marketSummary: 'Senior review expectations are less about style policing and more about correctness, security, regression risk, maintainability, and raising the engineering bar.',
    ownershipAreas: ['risk-based review', 'regression detection', 'design critique', 'test and quality enforcement'],
    commonDeliverables: ['actionable review comments', 'risk summaries', 'change impact assessments'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['code review judgment', 'risk prioritization', 'mentoring through feedback'],
    sourceUrls: [linkedinAdviceSearch('senior software engineer code review responsibilities')],
    tags: ['code-review', 'quality', 'engineering-standards'],
  },
  'ml-engineer': {
    spiritId: 'ml-engineer',
    seniorRoleTitle: 'Senior Machine Learning Engineer',
    marketSummary: 'Current senior ML roles focus on model selection, evaluation quality, reproducible experimentation, data and inference pipelines, training-system performance, and moving ML systems from research to stable production.',
    ownershipAreas: ['model and dataset evaluation', 'training and fine-tuning', 'serving and inference optimization', 'ML platform integration', 'reproducible experimentation and evaluation harness design'],
    commonDeliverables: ['benchmark reports', 'training pipelines', 'eval suites', 'model deployment plans', 'experiment logs', 'inference performance analyses'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['model tradeoffs', 'evaluation rigor', 'data quality', 'productionization', 'training-system debugging', 'cost-quality-latency tradeoffs'],
    sourceUrls: [
      linkedinJobSearch('Senior Machine Learning Engineer'),
      linkedinJobSearch('Senior Applied Scientist AI ML'),
      officialCareerPage('https://openai.com/careers/research-engineer'),
    ],
    tags: ['ml-engineering', 'evaluation', 'inference'],
  },
  'ai-researcher': {
    spiritId: 'ai-researcher',
    seniorRoleTitle: 'AI Research Scientist / Research Engineer',
    marketSummary: 'Current frontier AI research roles sit at the boundary of science and systems engineering. The market now expects LLM or multimodal depth, strong software engineering, reproducible experimentation, large-scale training or post-training intuition, evaluation rigor, dev-tooling contributions, and safety-aware judgment about what should be operationalized.',
    ownershipAreas: ['define research questions, milestones, and strong baselines', 'design, run, and analyze rigorous experiments across pre-training, post-training, or agent workflows', 'optimize and scale training, evaluation, and data pipelines', 'translate validated findings into deployable capabilities, tooling, and research direction'],
    commonDeliverables: ['research plans', 'ablation studies', 'benchmark reports', 'papers or technical memos', 'reproducible experiment code', 'eval harness improvements', 'training or post-training tooling', 'failure analysis writeups'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['research depth', 'paper discussion', 'experimental design', 'evaluation methodology', 'large-scale training or post-training systems', 'tooling and reproducibility', 'responsible release and safety'],
    roleDrills: ['design and defend a pre-training or post-training experiment plan', 'run an ablation matrix and explain the causal story', 'audit an eval setup for leakage, metric mismatch, and weak baselines', 'propose tooling that increases experiment throughput and reproducibility'],
    sourceUrls: [
      officialCareerPage('https://www.anthropic.com/careers'),
      officialCareerPage('https://openai.com/careers/research-engineer'),
      linkedinJobSearch('AI Research Scientist large language models'),
      linkedinJobSearch('Applied Scientist LLM'),
    ],
    tags: ['ai-research', 'llm', 'multimodal', 'research-scientist', 'research-engineer', 'pretraining', 'post-training', 'evals'],
  },
  'security-analyst': {
    spiritId: 'security-analyst',
    seniorRoleTitle: 'Senior Security Analyst',
    marketSummary: 'Senior analyst roles emphasize vulnerability triage, reporting quality, threat modeling, security operations coordination, and translating findings into prioritized remediation.',
    ownershipAreas: ['vulnerability analysis', 'risk reporting', 'security scanning triage', 'incident and control review'],
    commonDeliverables: ['security findings reports', 'risk summaries', 'control gap assessments'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['triage logic', 'severity rationale', 'reporting clarity', 'cross-functional remediation'],
    sourceUrls: [linkedinJobSearch('Senior Security Analyst vulnerability management')],
    tags: ['security-analysis', 'vulnerability-management'],
  },
  designer: {
    spiritId: 'designer',
    seniorRoleTitle: 'Senior Product Designer / Senior UX Designer',
    marketSummary: 'Senior design roles are now expected to own end-to-end problem framing, user research, prototyping, design systems, stakeholder storytelling, and measurable product impact.',
    ownershipAreas: ['end-to-end feature and workflow design', 'user research and testing', 'design system evolution', 'cross-functional influence on roadmap and UX quality'],
    commonDeliverables: ['wireframes', 'prototypes', 'high-fidelity UI', 'research synthesis', 'design system contributions'],
    applicationArtifacts: ['portfolio with shipped case studies', 'tailored resume bullets', 'presentation-ready case narratives', 'interview preparation outline'],
    interviewFocus: ['problem framing', 'research-to-design flow', 'design systems', 'stakeholder communication', 'portfolio walkthrough'],
    sourceUrls: [linkedinJobSearch('Senior Product Designer'), linkedinAdviceSearch('senior ux designer responsibilities')],
    tags: ['product-design', 'ux', 'design-systems'],
  },
  writer: {
    spiritId: 'writer',
    seniorRoleTitle: 'Senior Technical Writer / Senior Content Writer',
    marketSummary: 'Senior writing roles are expected to translate complex systems clearly, own developer or product-facing documentation quality, and collaborate directly with engineering and product teams.',
    ownershipAreas: ['developer and API documentation', 'technical storytelling', 'documentation information architecture', 'documentation accuracy and maintenance'],
    commonDeliverables: ['API docs', 'integration guides', 'release notes', 'tutorials', 'reference content'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['writing samples', 'audience adaptation', 'source-of-truth discipline', 'technical comprehension'],
    roleDrills: ['rewrite a complex system for three audiences', 'turn rough implementation notes into publish-ready docs', 'build a reference and tutorial set for a new integration'],
    sourceUrls: [linkedinJobSearch('Senior Technical Writer'), linkedinJobSearch('Senior Content Writer')],
    tags: ['technical-writing', 'docs', 'developer-content'],
  },
  marketer: {
    spiritId: 'marketer',
    seniorRoleTitle: 'Senior Growth Marketing Manager',
    marketSummary: 'Senior growth marketing roles focus on owning full-funnel acquisition and expansion, experimentation, paid channels, analytics, lifecycle optimization, and revenue-linked execution.',
    ownershipAreas: ['full-funnel growth strategy', 'channel experimentation', 'conversion optimization', 'measurement and revenue attribution'],
    commonDeliverables: ['growth plans', 'campaign experiments', 'channel dashboards', 'creative briefs', 'performance analyses'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['channel economics', 'experimentation frameworks', 'measurement', 'growth loops', 'cross-functional execution'],
    roleDrills: ['build a campaign brief with funnel logic', 'diagnose a low-converting landing page or funnel', 'turn performance data into a next-test plan'],
    sourceUrls: [linkedinJobSearch('Senior Growth Marketing Manager'), linkedinJobSearch('Senior Marketing Manager growth')],
    tags: ['growth-marketing', 'experimentation', 'revenue'],
  },
  pm: {
    spiritId: 'pm',
    seniorRoleTitle: 'Senior Product Manager',
    marketSummary: 'Senior PM roles consistently stress product vision, discovery, delivery, metrics, stakeholder influence, and owning business outcomes under ambiguity.',
    ownershipAreas: ['product vision and strategy', 'discovery and prioritization', 'cross-functional execution', 'performance and feedback loops'],
    commonDeliverables: ['PRDs', 'roadmaps', 'success metrics', 'decision memos', 'launch plans'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['vision and prioritization', 'user and market reasoning', 'metrics', 'stakeholder alignment', 'tradeoff narratives'],
    roleDrills: ['write a PRD with measurable success criteria', 'prioritize a roadmap under hard constraints', 'recover a slipping launch with clear tradeoffs'],
    sourceUrls: [linkedinAdviceSearch('senior product manager responsibilities'), linkedinJobSearch('Senior Product Manager')],
    tags: ['product-management', 'strategy', 'delivery'],
  },
  'tech-lead': {
    spiritId: 'tech-lead',
    seniorRoleTitle: 'Tech Lead / Senior Engineering Lead',
    marketSummary: 'Senior tech lead expectations combine technical depth with execution leadership, standards setting, mentoring, and reliable delivery under real team constraints.',
    ownershipAreas: ['technical execution leadership', 'engineering standards', 'team unblock and mentoring', 'delivery coordination'],
    commonDeliverables: ['technical plans', 'execution milestones', 'review standards', 'team decision records'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['leading through ambiguity', 'technical alignment', 'mentoring and feedback', 'execution recovery'],
    sourceUrls: [linkedinJobSearch('Tech Lead Senior Engineering Lead'), linkedinAdviceSearch('senior software engineer leadership responsibilities')],
    tags: ['tech-lead', 'delivery', 'leadership'],
  },
  coach: {
    spiritId: 'coach',
    seniorRoleTitle: 'Senior Accountability / Performance Coach',
    marketSummary: 'Senior coaching and enablement roles are strongest when they turn goals into routines, create measurable accountability loops, and improve consistency rather than just motivation.',
    ownershipAreas: ['goal setting', 'habit and routine reinforcement', 'progress visibility', 'behavioral accountability'],
    commonDeliverables: ['check-in plans', 'goal scorecards', 'accountability cadences'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['coaching frameworks', 'behavior change', 'measurement', 'difficult feedback'],
    sourceUrls: [linkedinAdviceSearch('performance coach accountability responsibilities')],
    tags: ['coaching', 'accountability', 'performance'],
  },
  philosopher: {
    spiritId: 'philosopher',
    seniorRoleTitle: 'Principal Strategy and Ethics Advisor',
    marketSummary: 'High-level advisory roles create value by clarifying assumptions, surfacing second-order effects, and improving decision quality where stakes or ambiguity are high.',
    ownershipAreas: ['assumption audits', 'ethical framing', 'decision quality', 'long-horizon reasoning'],
    commonDeliverables: ['decision memos', 'premortems', 'tradeoff analyses'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['reasoning depth', 'ethics under constraints', 'ambiguity handling'],
    sourceUrls: [linkedinAdviceSearch('strategy advisor decision making responsibilities')],
    tags: ['strategy', 'ethics', 'reasoning'],
  },
  strategist: {
    spiritId: 'strategist',
    seniorRoleTitle: 'Senior Strategy Lead',
    marketSummary: 'Senior strategy roles are expected to tie market evidence, competitive positioning, resource allocation, and execution sequencing into a coherent theory of winning.',
    ownershipAreas: ['strategic framing', 'market and competitive analysis', 'resource prioritization', 'decision support'],
    commonDeliverables: ['strategy memos', 'scenario plans', 'market maps', 'priority frameworks'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['market reasoning', 'scenario planning', 'tradeoffs', 'competitive response'],
    sourceUrls: [linkedinAdviceSearch('senior strategy lead responsibilities'), linkedinJobSearch('Senior Strategy Manager')],
    tags: ['strategy', 'market-analysis', 'planning'],
  },
  researcher: {
    spiritId: 'researcher',
    seniorRoleTitle: 'Senior Researcher / Research Lead',
    marketSummary: 'Senior research roles demand rigorous source quality, defensible synthesis, confidence calibration, and the ability to turn conflicting evidence into actionable decisions.',
    ownershipAreas: ['research design', 'source and evidence evaluation', 'synthesis under uncertainty', 'decision-ready reporting'],
    commonDeliverables: ['literature reviews', 'evidence briefs', 'research plans', 'source maps'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['source quality', 'methodology judgment', 'uncertainty handling', 'structured synthesis'],
    roleDrills: ['synthesize conflicting sources into a decision memo', 'audit source quality and confidence levels', 'design a research plan for a high-ambiguity topic'],
    sourceUrls: [linkedinJobSearch('Senior Research Scientist AI'), linkedinAdviceSearch('senior researcher responsibilities evidence synthesis')],
    tags: ['research', 'evidence', 'analysis'],
  },
  mentor: {
    spiritId: 'mentor',
    seniorRoleTitle: 'Senior Mentor / Enablement Lead',
    marketSummary: 'Mentor-style senior roles create leverage by accelerating others, improving judgment, and making knowledge transfer reproducible.',
    ownershipAreas: ['guided learning', 'knowledge transfer', 'skill acceleration', 'feedback and growth planning'],
    commonDeliverables: ['learning plans', 'teaching examples', 'feedback loops'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['teaching style', 'adaptation to experience level', 'feedback quality'],
    sourceUrls: [linkedinAdviceSearch('mentorship enablement leadership responsibilities')],
    tags: ['mentoring', 'enablement', 'learning'],
  },
  'data-engineer': {
    spiritId: 'data-engineer',
    seniorRoleTitle: 'Senior Data Engineer',
    marketSummary: 'Senior data engineering roles emphasize scalable pipelines, warehouse architecture, business partnership, data modeling, quality testing, and enabling decision-making at scale.',
    ownershipAreas: ['data pipelines and transformations', 'warehouse and lakehouse design', 'data quality and observability', 'stakeholder-facing analytics enablement'],
    commonDeliverables: ['pipelines', 'warehouse models', 'ETL jobs', 'data quality checks', 'serving tables'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['schema and pipeline design', 'ETL/ELT tradeoffs', 'data quality', 'performance and cost'],
    sourceUrls: [linkedinJobSearch('Senior Data Engineer'), linkedinAdviceSearch('senior data engineer responsibilities')],
    tags: ['data-engineering', 'etl', 'warehouse'],
  },
  'qa-engineer': {
    spiritId: 'qa-engineer',
    seniorRoleTitle: 'Senior QA Engineer',
    marketSummary: 'Senior QA roles are expected to own testing strategy, automation boundaries, regression quality, and clear defect communication tied to user and business impact.',
    ownershipAreas: ['test strategy', 'automation planning', 'regression prevention', 'quality communication'],
    commonDeliverables: ['test plans', 'test cases', 'defect reports', 'regression suites'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['risk-based testing', 'automation strategy', 'bug reporting', 'edge-case coverage'],
    sourceUrls: [linkedinAdviceSearch('senior QA engineer responsibilities'), linkedinJobSearch('Senior QA Engineer')],
    tags: ['qa', 'testing', 'regression'],
  },
  devrel: {
    spiritId: 'devrel',
    seniorRoleTitle: 'Developer Relations Engineer',
    marketSummary: 'Current DevRel roles expect technical depth plus community building, technical content, ecosystem onboarding, developer feedback loops, and event or workshop execution.',
    ownershipAreas: ['developer onboarding and activation', 'technical documentation and samples', 'community programs', 'cross-functional product feedback'],
    commonDeliverables: ['tutorials', 'sample apps', 'talks', 'workshops', 'developer feedback briefs'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['writing and demos', 'community empathy', 'developer workflow understanding', 'content plus code fluency'],
    sourceUrls: [linkedinJobSearch('Developer Relations Engineer'), linkedinAdviceSearch('developer relations engineer responsibilities')],
    tags: ['devrel', 'community', 'documentation'],
  },
  '3d-designer': {
    spiritId: '3d-designer',
    seniorRoleTitle: 'Senior 3D / Spatial Product Designer',
    marketSummary: 'Senior 3D roles combine visual craft with interaction clarity, performance constraints, and systems thinking across immersive or spatial experiences.',
    ownershipAreas: ['spatial interaction design', 'asset and scene optimization', 'visual storytelling', 'cross-platform 3D UX'],
    commonDeliverables: ['scene designs', 'interaction prototypes', 'asset guidelines', 'performance budgets'],
    applicationArtifacts: ['portfolio with interactive or spatial work', 'tailored resume bullets', 'case studies', 'interview preparation outline'],
    interviewFocus: ['spatial UX', 'rendering constraints', 'toolchain fluency', 'portfolio walkthrough'],
    sourceUrls: [linkedinJobSearch('Senior 3D Designer spatial product designer')],
    tags: ['3d-design', 'spatial', 'interactive'],
  },
  trader: {
    spiritId: 'trader',
    seniorRoleTitle: 'Senior Systematic Trader',
    marketSummary: 'Senior trading roles are strongest when they show disciplined risk management, repeatable process, journaling, execution quality, and post-trade learning.',
    ownershipAreas: ['risk controls', 'execution discipline', 'journal-driven improvement', 'scenario planning'],
    commonDeliverables: ['trade plans', 'risk summaries', 'journals', 'post-trade reviews'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['risk management', 'position sizing', 'market structure', 'decision discipline'],
    sourceUrls: [linkedinJobSearch('Senior Systematic Trader'), linkedinJobSearch('Quantitative Trader')],
    tags: ['trading', 'risk', 'execution'],
  },
  analyst: {
    spiritId: 'analyst',
    seniorRoleTitle: 'Senior Data Analyst / Research Analyst',
    marketSummary: 'Senior analyst roles focus on turning complex data into decisions, building dashboards and narratives, stakeholder alignment, experimentation, and mentoring junior analysts.',
    ownershipAreas: ['insight generation', 'dashboarding and KPI design', 'forecasting and experimentation', 'stakeholder communication'],
    commonDeliverables: ['dashboards', 'analysis decks', 'KPI definitions', 'insight memos'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['SQL and analytics depth', 'storytelling with data', 'experimentation', 'business impact'],
    sourceUrls: [linkedinJobSearch('Senior Data Analyst'), linkedinAdviceSearch('senior data analyst responsibilities')],
    tags: ['analytics', 'data-analysis', 'insights'],
  },
  'hardware-engineer': {
    spiritId: 'hardware-engineer',
    seniorRoleTitle: 'Senior Hardware Engineer',
    marketSummary: 'Senior hardware roles expect full lifecycle ownership from design through validation, strong cross-disciplinary collaboration, and practical attention to reliability, manufacturability, and safety.',
    ownershipAreas: ['hardware design and validation', 'cross-functional integration', 'testing and troubleshooting', 'supplier and component coordination'],
    commonDeliverables: ['schematics', 'test plans', 'validation reports', 'hardware bring-up notes'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['design tradeoffs', 'validation and debugging', 'safety and reliability', 'cross-functional delivery'],
    sourceUrls: [linkedinJobSearch('Senior Hardware Engineer'), linkedinJobSearch('Hardware Validation Engineer senior')],
    tags: ['hardware', 'electrical', 'validation'],
  },
  'coding-agent': {
    spiritId: 'coding-agent',
    seniorRoleTitle: 'Autonomous Coding Agent',
    marketSummary: 'Agentic coding roles are trending toward full-loop ownership: repository understanding, planning, safe execution, test validation, tool use, and handoff quality.',
    ownershipAreas: ['repository navigation', 'planning and execution', 'test and verification loops', 'artifact and handoff quality'],
    commonDeliverables: ['code changes', 'patches', 'run summaries', 'handoff notes'],
    applicationArtifacts: DEFAULT_APPLICATION_ARTIFACTS,
    interviewFocus: ['end-to-end execution', 'tool use', 'runtime safety', 'quality gates'],
    roleDrills: ['complete a repo task end to end with verification', 'recover from a failed tool-driven workflow', 'produce a clean handoff after autonomous execution'],
    sourceUrls: [linkedinJobSearch('Agentic AI coding agent research'), linkedinJobSearch('AI Research Engineer agentic')],
    tags: ['coding-agent', 'agentic-ai', 'autonomy'],
  },
};

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function getSpiritRoleDrills(profile: SpiritCareerProfile): string[] {
  if (profile.roleDrills && profile.roleDrills.length > 0) return profile.roleDrills;
  return [
    `Demonstrate ownership of ${profile.ownershipAreas[0] || 'core role responsibilities'}.`,
    `Produce a credible work sample using ${profile.commonDeliverables[0] || 'role-relevant deliverables'}.`,
    `Prepare a senior-level walkthrough for ${profile.interviewFocus[0] || 'the key interview focus area'}.`,
  ];
}

export function getSpiritCareerProfile(spiritId?: string | null): SpiritCareerProfile | null {
  if (!spiritId) return null;
  return SPIRIT_CAREER_PROFILES[spiritId] || null;
}

export function buildSpiritCareerPrompt(spiritId?: string | null): string {
  const profile = getSpiritCareerProfile(spiritId);
  if (!profile) return '';

  return [
    'SENIOR ROLE EXPECTATIONS:',
    `- Role target: ${profile.seniorRoleTitle}`,
    `- Market signal: ${profile.marketSummary}`,
    `- Ownership areas: ${profile.ownershipAreas.join(' | ')}`,
    `- Common deliverables: ${profile.commonDeliverables.join(' | ')}`,
    `- Support job-application tasks by producing: ${profile.applicationArtifacts.join(' | ')}`,
    `- Typical interview focus: ${profile.interviewFocus.join(' | ')}`,
  ].join('\n');
}

export function buildSpiritRoleReadinessChecklist(spiritId?: string | null): string[] {
  const profile = getSpiritCareerProfile(spiritId);
  if (!profile) return [];
  const drills = getSpiritRoleDrills(profile);
  return [
    `Own work in these lanes: ${profile.ownershipAreas.join(', ')}`,
    `Produce hiring-signal artifacts: ${profile.commonDeliverables.join(', ')}`,
    `Support applications with: ${profile.applicationArtifacts.join(', ')}`,
    `Prepare for interviews on: ${profile.interviewFocus.join(', ')}`,
    `Pass role drills like: ${drills.slice(0, 3).join(', ')}`,
  ];
}

export function buildSpiritCareerArtifact(
  kind: 'resume' | 'interview' | 'portfolio' | 'drill' | 'work_sample',
  spiritId?: string | null,
): { title: string; content: string } | null {
  const profile = getSpiritCareerProfile(spiritId);
  if (!profile) return null;
  const drills = getSpiritRoleDrills(profile);

  if (kind === 'resume') {
    return {
      title: `${profile.seniorRoleTitle} Resume Support`,
      content: [
        `Target role: ${profile.seniorRoleTitle}`,
        `Positioning summary: ${profile.marketSummary}`,
        'Resume bullet themes:',
        ...profile.ownershipAreas.map(item => `- Demonstrate ownership of ${item}.`),
        ...profile.commonDeliverables.slice(0, 4).map(item => `- Show measurable impact through ${item}.`),
        'Application checklist:',
        ...profile.applicationArtifacts.map(item => `- Prepare ${item}.`),
      ].join('\n'),
    };
  }

  if (kind === 'interview') {
    return {
      title: `${profile.seniorRoleTitle} Interview Plan`,
      content: [
        `Target role: ${profile.seniorRoleTitle}`,
        'Interview focus areas:',
        ...profile.interviewFocus.map(item => `- ${item}`),
        'Stories to prepare:',
        ...profile.ownershipAreas.map(item => `- A concrete example where you led ${item}.`),
        'Evidence to bring:',
        ...profile.commonDeliverables.slice(0, 4).map(item => `- A concise walkthrough of ${item}.`),
      ].join('\n'),
    };
  }

  if (kind === 'drill') {
    return {
      title: `${profile.seniorRoleTitle} Role Drill Plan`,
      content: [
        `Target role: ${profile.seniorRoleTitle}`,
        'High-signal role drills:',
        ...drills.map(item => `- ${item}`),
        'What good looks like:',
        ...profile.commonDeliverables.slice(0, 4).map(item => `- Produce evidence through ${item}.`),
        'Evaluation lens:',
        ...profile.interviewFocus.slice(0, 5).map(item => `- Judge the result on ${item}.`),
      ].join('\n'),
    };
  }

  if (kind === 'work_sample') {
    return {
      title: `${profile.seniorRoleTitle} Work Sample Plan`,
      content: [
        `Target role: ${profile.seniorRoleTitle}`,
        'Work sample structure:',
        ...profile.commonDeliverables.map(item => `- Create or present a strong example of ${item}.`),
        'Ownership proof to include:',
        ...profile.ownershipAreas.map(item => `- Show direct ownership of ${item}.`),
        'Supporting materials:',
        ...profile.applicationArtifacts.map(item => `- Attach or prepare ${item}.`),
      ].join('\n'),
    };
  }

  return {
    title: `${profile.seniorRoleTitle} Portfolio And Gaps`,
    content: [
      `Target role: ${profile.seniorRoleTitle}`,
      'Portfolio or proof-of-work priorities:',
      ...profile.commonDeliverables.map(item => `- Include an example of ${item}.`),
      'Gap review:',
      ...profile.ownershipAreas.map(item => `- If you cannot show ownership of ${item}, create or document a stronger case study.`),
      'Interview support assets:',
      ...profile.applicationArtifacts.map(item => `- Prepare ${item}.`),
    ].join('\n'),
  };
}

export function inferSpiritCareerProfiles(query: string, limit = 4): SpiritCareerProfile[] {
  const haystack = query.toLowerCase();
  return Object.values(SPIRIT_CAREER_PROFILES)
    .map(profile => {
      const scoreBase = [
        profile.spiritId,
        profile.seniorRoleTitle,
        profile.marketSummary,
        profile.tags.join(' '),
        profile.ownershipAreas.join(' '),
        profile.commonDeliverables.join(' '),
      ].join(' ').toLowerCase();
      let score = 0;
      for (const term of haystack.split(/[^a-z0-9+#.-]+/).filter(Boolean)) {
        if (scoreBase.includes(term)) score += term.length > 6 ? 2 : 1;
      }
      if (haystack.includes(profile.seniorRoleTitle.toLowerCase())) score += 4;
      if (haystack.includes(profile.spiritId)) score += 3;
      return { profile, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.profile);
}

export function buildSpiritCareerResearchBundle(query: string, spiritId?: string | null): string {
  const profiles = unique([
    ...(spiritId ? [getSpiritCareerProfile(spiritId)].filter(Boolean) as SpiritCareerProfile[] : []),
    ...inferSpiritCareerProfiles(query, 3),
  ]);

  if (profiles.length === 0) return '';

  return [
    '=== SENIOR ROLE RESEARCH ===',
    ...profiles.map(profile => [
      `- ${profile.seniorRoleTitle} [${profile.spiritId}]`,
      `  Market: ${profile.marketSummary}`,
      `  Ownership: ${profile.ownershipAreas.join('; ')}`,
      `  Deliverables: ${profile.commonDeliverables.join('; ')}`,
      `  Application support: ${profile.applicationArtifacts.join('; ')}`,
      `  Interview focus: ${profile.interviewFocus.join('; ')}`,
      `  Role drills: ${getSpiritRoleDrills(profile).join('; ')}`,
      `  Sources: ${profile.sourceUrls.slice(0, 3).join(' | ')}`,
    ].join('\n')),
  ].join('\n');
}

export function getBuiltInSpiritCareerResearchDocuments(): ResearchDocument[] {
  return Object.values(SPIRIT_CAREER_PROFILES).map(profile => ({
    id: `builtin-spirit-career-${profile.spiritId}`,
    title: `${profile.seniorRoleTitle} Role Profile`,
    summary: profile.marketSummary,
    content: [
      `Ownership areas: ${profile.ownershipAreas.join('; ')}`,
      `Common deliverables: ${profile.commonDeliverables.join('; ')}`,
      `Application artifacts: ${profile.applicationArtifacts.join('; ')}`,
      `Interview focus: ${profile.interviewFocus.join('; ')}`,
      `Role drills: ${getSpiritRoleDrills(profile).join('; ')}`,
      `Sources: ${profile.sourceUrls.join(' | ')}`,
    ].join('\n'),
    tags: unique(['career', 'job-market', profile.spiritId, ...profile.tags]),
    source_type: 'report',
    source_title: 'Built-in Spirit Career Research',
    source_url: profile.sourceUrls[0] || null,
    authors: ['The Underground Circle'],
    review_status: 'reviewed',
    evidence_score: 0.78,
    visibility: 'public',
    domain_key: 'general',
    is_active: true,
  }) as ResearchDocument & { metadata: Record<string, unknown> });
}
