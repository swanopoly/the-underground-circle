export type ImpactDomainKey =
  | 'general'
  | 'civil_infrastructure'
  | 'cancer_research'
  | 'medical_imaging'
  | 'clinical_decision_support'
  | 'materials_science'
  | 'renewable_energy'
  | 'human_flourishing';

export interface ImpactDomainProfile {
  key: ImpactDomainKey;
  label: string;
  mission: string;
  examples: string[];
  guidance: string[];
  evaluationPriorities: string[];
  keywords: string[];
}

export const IMPACT_DOMAINS: Record<ImpactDomainKey, ImpactDomainProfile> = {
  general: {
    key: 'general',
    label: 'General Impact Work',
    mission: 'Improve useful execution quality without domain-specific scientific or public-good constraints.',
    examples: ['general research', 'product strategy', 'knowledge organization'],
    guidance: [
      'Prefer explicit tradeoffs over vague brainstorming.',
      'Separate verified facts from speculation.',
      'Produce outputs that are actionable and reviewable.',
    ],
    evaluationPriorities: ['clarity', 'actionability', 'traceability'],
    keywords: [],
  },
  civil_infrastructure: {
    key: 'civil_infrastructure',
    label: 'Civil Infrastructure',
    mission: 'Support safe, code-aware, constructible decisions across structures, geotechnical work, transportation, site development, drainage, permitting, and public-works execution.',
    examples: ['drainage review', 'foundation recommendation', 'traffic control review', 'earthwork QA/QC', 'culvert or grading analysis'],
    guidance: [
      'Protect life safety and public welfare first, and distinguish conceptual guidance from sealed design.',
      'State governing assumptions, code/owner-standard unknowns, and site-data gaps explicitly.',
      'Prefer outputs that support reviewable calculations, field QA/QC, permitting, and construction decision records.',
    ],
    evaluationPriorities: ['public safety', 'code awareness', 'constructability', 'traceability', 'field verification'],
    keywords: ['civil', 'infrastructure', 'stormwater', 'drainage', 'grading', 'culvert', 'bridge', 'roadway', 'traffic control', 'foundation', 'geotechnical', 'earthwork', 'retaining', 'excavation', 'concrete', 'rebar', 'steel', 'pavement', 'survey'],
  },
  cancer_research: {
    key: 'cancer_research',
    label: 'Cancer Research',
    mission: 'Support cancer research workflows, literature synthesis, biomarker reasoning, and decision support artifacts for researchers.',
    examples: ['oncology literature review', 'biomarker hypothesis mapping', 'trial landscape synthesis'],
    guidance: [
      'Do not claim diagnosis or treatment decisions; support research analysis and evidence synthesis.',
      'Highlight uncertainty, sample-size limits, and external validation needs.',
      'Prefer structured outputs that can be reviewed by clinicians or researchers.',
    ],
    evaluationPriorities: ['evidence quality', 'uncertainty handling', 'clinical safety', 'citation quality'],
    keywords: ['cancer', 'oncology', 'tumor', 'biomarker', 'metastasis', 'radiology', 'histopathology', 'chemotherapy'],
  },
  medical_imaging: {
    key: 'medical_imaging',
    label: 'Medical Imaging',
    mission: 'Assist with imaging-analysis workflows, dataset review, annotation planning, and model-evaluation reasoning for modalities like MRI, CT, and X-ray.',
    examples: ['MRI analysis workflow', 'scan triage pipeline', 'annotation rubric for lesions'],
    guidance: [
      'Treat outputs as decision support, not autonomous diagnosis.',
      'Optimize for sensitivity/specificity tradeoffs and reviewer workflow quality.',
      'Emphasize dataset bias, calibration, and audit trails.',
    ],
    evaluationPriorities: ['safety', 'false positive/negative tradeoffs', 'auditability', 'human review'],
    keywords: ['mri', 'ct', 'xray', 'radiology', 'scan', 'imaging', 'lesion', 'segmentation', 'dicom'],
  },
  clinical_decision_support: {
    key: 'clinical_decision_support',
    label: 'Clinical Decision Support',
    mission: 'Improve physician accuracy, workflow support, triage reasoning, and evidence-backed assistance without replacing clinicians.',
    examples: ['disease identification support', 'doctor accuracy augmentation', 'differential support workflow'],
    guidance: [
      'Keep clinicians in the loop and make escalation boundaries explicit.',
      'Surface confidence, contraindications, and missing information clearly.',
      'Design for workflow augmentation rather than full autonomy.',
    ],
    evaluationPriorities: ['human oversight', 'calibration', 'explainability', 'patient safety'],
    keywords: ['disease', 'diagnosis', 'doctor', 'physician', 'clinical', 'triage', 'screening', 'accuracy'],
  },
  materials_science: {
    key: 'materials_science',
    label: 'Materials Science',
    mission: 'Support discovery, optimization, and analysis of materials that improve manufacturing, infrastructure, health, and sustainability.',
    examples: ['battery materials review', 'polymer property search', 'catalyst screening framework'],
    guidance: [
      'Prefer measurable material properties, constraints, and experimental protocols.',
      'Keep simulation claims separate from validated physical results.',
      'Track cost, manufacturability, and sustainability alongside performance.',
    ],
    evaluationPriorities: ['experimental grounding', 'reproducibility', 'property relevance', 'manufacturability'],
    keywords: ['material', 'materials', 'battery', 'alloy', 'polymer', 'catalyst', 'semiconductor', 'nanomaterial'],
  },
  renewable_energy: {
    key: 'renewable_energy',
    label: 'Renewable Energy',
    mission: 'Support renewable energy research, deployment planning, storage reasoning, grid optimization, and technology comparison.',
    examples: ['solar storage research', 'grid optimization', 'renewable deployment planning'],
    guidance: [
      'Compare technologies on lifecycle performance, economics, and deployment constraints.',
      'Include storage, transmission, and reliability tradeoffs.',
      'Avoid single-metric optimization when system-level effects matter.',
    ],
    evaluationPriorities: ['system efficiency', 'cost realism', 'deployment feasibility', 'climate impact'],
    keywords: ['renewable', 'solar', 'wind', 'grid', 'battery', 'storage', 'energy', 'geothermal', 'fusion'],
  },
  human_flourishing: {
    key: 'human_flourishing',
    label: 'Human Flourishing',
    mission: 'Improve human life, culture, health, education, and societal capability in ways that scale across different communities and countries.',
    examples: ['education systems', 'public health support', 'human development research'],
    guidance: [
      'Optimize for broad human benefit, not just local feature velocity.',
      'Consider cultural context, access, equity, and unintended consequences.',
      'Prefer interventions that increase capability, autonomy, and wellbeing.',
    ],
    evaluationPriorities: ['human benefit', 'global accessibility', 'equity', 'long-term resilience'],
    keywords: ['human life', 'culture', 'education', 'public health', 'wellbeing', 'society', 'humanity', 'global'],
  },
};

export function getImpactDomain(key?: string | null): ImpactDomainProfile {
  if (!key) return IMPACT_DOMAINS.general;
  return IMPACT_DOMAINS[key as ImpactDomainKey] || IMPACT_DOMAINS.general;
}

export function inferImpactDomain(input: { title?: string; description?: string; query?: string }): ImpactDomainKey {
  const haystack = `${input.title || ''} ${input.description || ''} ${input.query || ''}`.toLowerCase();
  let best: { key: ImpactDomainKey; score: number } = { key: 'general', score: 0 };

  for (const domain of Object.values(IMPACT_DOMAINS)) {
    if (domain.key === 'general') continue;
    let score = 0;
    for (const keyword of domain.keywords) {
      if (haystack.includes(keyword)) score += keyword.length > 6 ? 2 : 1;
    }
    if (score > best.score) best = { key: domain.key, score };
  }

  return best.key;
}

export function buildImpactDomainGuidance(input: {
  title?: string;
  description?: string;
  query?: string;
  domainKey?: string | null;
}): string {
  const domain = getImpactDomain(input.domainKey || inferImpactDomain(input));
  if (domain.key === 'general') return '';

  return [
    `=== IMPACT DOMAIN: ${domain.label.toUpperCase()} ===`,
    `Mission: ${domain.mission}`,
    `Examples: ${domain.examples.join(' | ')}`,
    `Guidance:`,
    ...domain.guidance.map(item => `- ${item}`),
    `Evaluation priorities: ${domain.evaluationPriorities.join(', ')}`,
  ].join('\n');
}

export function buildImpactDomainCoverageSummary(): string {
  return Object.values(IMPACT_DOMAINS)
    .filter(domain => domain.key !== 'general')
    .map(domain => `${domain.label}`)
    .join(' | ');
}
