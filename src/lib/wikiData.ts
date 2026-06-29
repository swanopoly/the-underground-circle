// =============================================================================
// Wiki Data Layer
// Educational content about AI, technology, systems, science, cities, design,
// and durable operating patterns.
// Connects to the Schools education section via relatedLessonIds.
// =============================================================================
import { buildImpactDomainCoverageSummary, buildImpactDomainGuidance, inferImpactDomain } from './impactDomains';
import { getSpiritById } from './agentSpirits';
import { getSpiritCareerProfile } from './spiritCareerProfiles';
import { getSpiritOperationsProfile } from './spiritOperationsProfiles';

export type WikiCategory =
  | 'agents'
  | 'models'
  | 'frameworks'
  | 'design'
  | 'open-source'
  | 'mcp'
  | 'foundations'
  | 'landscape'
  | 'future-cities'
  | 'science'
  | 'infrastructure'
  | 'health'
  | 'energy-materials';

export interface WikiArticle {
  id: string;
  title: string;
  subtitle: string;
  category: WikiCategory;
  icon: string;
  color: string;
  content: WikiSection[];
  relatedLessonIds?: string[];
  tags: string[];
}

export interface WikiSection {
  title: string;
  content: string;
  bulletPoints?: string[];
  codeExample?: string;
  tableData?: { headers: string[]; rows: string[][] };
}

export interface WikiCategoryInfo {
  id: WikiCategory;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  articleCount: number;
}

export interface WikiArticleReference {
  id: string;
  title: string;
  subtitle: string;
  category: WikiCategory;
  color: string;
  tags: string[];
}

export interface WikiFuturePath {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  color: string;
  articleIds: string[];
  searchQuery: string;
  outcome: string;
}

export interface WikiBuilderPrompt {
  id: string;
  label: string;
  title: string;
  prompt: string;
  followUp: string;
  articleIds: string[];
  searchQuery: string;
}

export interface WikiResearchInsight {
  id: string;
  title: string;
  sourceLabel: string;
  sourceUrl: string;
  principle: string;
  addToWiki: string;
  userAction: string;
  searchQuery: string;
  color: string;
}

export interface WikiArticleLearningLoopStep {
  id: string;
  label: string;
  title: string;
  prompt: string;
  sourceLabel: string;
  sourceUrl: string;
  searchQuery: string;
}

// =============================================================================
// Categories
// =============================================================================

export const WIKI_CATEGORIES: Omit<WikiCategoryInfo, 'articleCount'>[] = [
  {
    id: 'agents',
    title: 'AI Coding Agents',
    subtitle: 'CLI tools and editors that write code with you',
    icon: '>_',
    color: '#22c55e',
  },
  {
    id: 'models',
    title: 'AI Models',
    subtitle: 'The large language models powering everything',
    icon: 'AI',
    color: '#6366f1',
  },
  {
    id: 'frameworks',
    title: 'Agent Frameworks',
    subtitle: 'SDKs and libraries for building AI agents',
    icon: '{}',
    color: '#f59e0b',
  },
  {
    id: 'design',
    title: 'Design Techniques',
    subtitle: 'Modern UI/UX patterns and visual design',
    icon: '[]',
    color: '#ec4899',
  },
  {
    id: 'open-source',
    title: 'Open Source AI',
    subtitle: 'Running and fine-tuning models on your own hardware',
    icon: 'OS',
    color: '#22d3ee',
  },
  {
    id: 'mcp',
    title: 'MCP Protocol',
    subtitle: 'The Model Context Protocol connecting AI to the world',
    icon: '<>',
    color: '#a855f7',
  },
  {
    id: 'foundations',
    title: 'AI Foundations',
    subtitle: 'History, concepts, and the durable ideas behind modern AI',
    icon: '::',
    color: '#14b8a6',
  },
  {
    id: 'landscape',
    title: 'AI Landscape',
    subtitle: 'Current-state radar reports on what is moving now',
    icon: '>>',
    color: '#84cc16',
  },
  {
    id: 'future-cities',
    title: 'Future Cities',
    subtitle: 'Retrofuturism, EPCOT, mobility, civic systems, and built-world prototypes',
    icon: 'CT',
    color: '#f59e0b',
  },
  {
    id: 'science',
    title: 'Science + Universe',
    subtitle: 'Space, cosmology, physics, biology, discovery systems, and scientific method',
    icon: 'SC',
    color: '#a855f7',
  },
  {
    id: 'infrastructure',
    title: 'Infrastructure',
    subtitle: 'Civil systems, transportation, utilities, resilient operations, and public works',
    icon: 'IF',
    color: '#38bdf8',
  },
  {
    id: 'health',
    title: 'Health + Biotech',
    subtitle: 'Medical AI, clinical decision support, biotechnology, and human health systems',
    icon: 'HX',
    color: '#ef4444',
  },
  {
    id: 'energy-materials',
    title: 'Energy + Materials',
    subtitle: 'Renewables, batteries, manufacturing, materials science, and climate technology',
    icon: 'EM',
    color: '#22c55e',
  },
];

// =============================================================================
// Articles
// =============================================================================

export const WIKI_ARTICLES: WikiArticle[] = [
  {
    id: 'future-cities-epcot-systems',
    title: 'Future Cities: EPCOT as a Systems Blueprint',
    subtitle: 'How Walt Disney style future-city thinking maps into transit, civic technology, logistics, public learning, and digital-brain design.',
    category: 'future-cities',
    icon: 'CT',
    color: '#f59e0b',
    tags: ['future-cities', 'epcot', 'urban-design', 'transportation', 'systems-design', 'retrofuturism'],
    content: [
      {
        title: 'Why Future Cities Belong In The Wiki',
        content:
          'The Wiki should not only explain AI tools. It should help users reason about whole systems. Future-city design is useful because it forces every layer to interact: movement, energy, housing, work, education, entertainment, logistics, governance, and public experience.',
        bulletPoints: [
          'A future city is an operating system for physical life',
          'Transportation, utilities, interfaces, and governance have to be designed together',
          'The same systems thinking applies to OpenSwan, Digital Brain, and multi-agent workflows',
        ],
      },
      {
        title: 'Disney Pattern: Prototype, Transit, Separation Of Flows',
        content:
          'The durable lesson from the original EPCOT idea is not a single building style. It is the concept of a continuously updated prototype community with clear movement layers. Pedestrians, transit, cars, deliveries, services, and public experiences should not fight for the same path.',
        bulletPoints: [
          'Use radial or hub-and-spoke maps when users need legible movement through a complex system',
          'Separate high-trust/private flows from public-facing flows',
          'Make infrastructure visible enough to teach, but hidden enough not to overwhelm daily use',
        ],
      },
      {
        title: 'How This Maps To The App',
        content:
          'The Digital Brain System Flow can use future-city language directly. Site surfaces are districts. Agents are workers. Database tables are utilities. Vault credentials are secure infrastructure. Chat is the transit terminal. Wiki and Backpack are public learning plus private memory.',
        bulletPoints: [
          'Map every feature into a district with clear inbound and outbound flows',
          'Show data movement as transit instead of as static tables',
          'Let users inspect the system like a city map before they automate work',
        ],
      },
    ],
  },
  {
    id: 'universe-science-field-map',
    title: 'Universe Science Field Map',
    subtitle: 'A practical map for tracking space, cosmology, planetary science, and scientific uncertainty in the Digital Brain.',
    category: 'science',
    icon: 'SC',
    color: '#a855f7',
    tags: ['universe', 'science', 'space', 'cosmology', 'astronomy', 'scientific-method'],
    content: [
      {
        title: 'Why Broad Science Matters',
        content:
          'A useful knowledge system needs broad exploratory memory, not just work-specific facts. Space science, cosmology, biology, physics, and systems research create analogies that can improve product design, agent architecture, and long-range planning.',
        bulletPoints: [
          'Separate observations, models, hypotheses, and speculation',
          'Track source quality and publication date',
          'Use science notes as inspiration unless they are validated for an operational decision',
        ],
      },
      {
        title: 'Good Intake Shape',
        content:
          'A science intake note should capture the question, evidence, method, uncertainty, and possible analogy. For example: what was observed, how it was measured, what changed from prior understanding, and what design idea it could inspire.',
        bulletPoints: [
          'Question: what does this source try to explain?',
          'Evidence: what data or method supports it?',
          'Uncertainty: what would falsify or weaken it?',
          'Transfer: what analogy might help app, agent, or city design?',
        ],
      },
    ],
  },
  {
    id: 'infrastructure-public-systems',
    title: 'Infrastructure And Public Systems',
    subtitle: 'How roads, utilities, drainage, transport, maintenance, and operations thinking improve software and agent systems.',
    category: 'infrastructure',
    icon: 'IF',
    color: '#38bdf8',
    tags: ['infrastructure', 'civil', 'transportation', 'resilience', 'operations', 'maintenance'],
    content: [
      {
        title: 'Infrastructure Is Long-Term Software',
        content:
          'Infrastructure disciplines are useful for agent products because they optimize for safety, maintainability, capacity, inspection, and failure recovery. Those are the same properties needed when automations can touch real accounts, credentials, browsers, and computers.',
        bulletPoints: [
          'Design for inspection before autonomy',
          'Track capacity, bottlenecks, and failure modes',
          'Make maintenance routines explicit instead of relying on hero debugging',
        ],
      },
      {
        title: 'Operational Lessons',
        content:
          'A resilient system has routes, utilities, controls, maintenance schedules, permits, escalation paths, and shutoff valves. The app should mirror that: task routing, API budgets, vault controls, review queues, cron logs, and human approval boundaries.',
        bulletPoints: [
          'Every automation should have a clear owner and rollback path',
          'Every repeated job should have observability and cost caps',
          'Every critical credential path should be permissioned and auditable',
        ],
      },
    ],
  },
  {
    id: 'health-biotech-knowledge-safety',
    title: 'Health, Biotech, And Knowledge Safety',
    subtitle: 'How to store medical and biotech knowledge without pretending research notes are clinical advice.',
    category: 'health',
    icon: 'HX',
    color: '#ef4444',
    tags: ['health', 'biotech', 'medical-ai', 'clinical-safety', 'research', 'evidence'],
    content: [
      {
        title: 'Use The Right Safety Boundary',
        content:
          'Health and biotech knowledge can be valuable in the Wiki, but it needs a hard boundary. The system can summarize research, organize hypotheses, help compare evidence, and support workflow design. It should not make diagnosis, treatment, or medication decisions.',
        bulletPoints: [
          'Label research support separately from clinical guidance',
          'Keep human experts in the loop',
          'Track evidence quality, source, date, and uncertainty',
        ],
      },
      {
        title: 'What To Capture',
        content:
          'Good notes include the research question, population or dataset, method, results, limitations, and practical relevance. Weak notes skip limitations. Dangerous notes turn early findings into confident instructions.',
        bulletPoints: [
          'Capture limitations as first-class data',
          'Prefer review status and evidence score over raw excitement',
          'Escalate high-stakes claims for human review',
        ],
      },
    ],
  },
  {
    id: 'all-cancers-research-atlas',
    title: 'All Cancers Research Atlas',
    subtitle: 'A source-backed map of major cancer families, common cancer types, and the safest questions to ask before researching care.',
    category: 'health',
    icon: 'HX',
    color: '#ef4444',
    tags: ['cancer', 'oncology', 'health', 'biotech', 'research', 'taxonomy', 'patient-safety'],
    content: [
      {
        title: 'Educational Boundary',
        content:
          'Cancer content in the Wiki is research support, not medical advice. Cancer is not one disease. Care depends on the exact diagnosis, histology, stage, grade, biomarkers, health history, symptoms, goals, and clinician review.',
        bulletPoints: [
          'Use this article to organize research and questions',
          'Do not use it to diagnose symptoms or choose treatment',
          'Escalate treatment, medication, biopsy, imaging, or urgent symptom questions to qualified clinicians',
        ],
      },
      {
        title: 'Cancer Families',
        content:
          'A useful cancer map starts with tissue and cell origin. Body site alone is not enough because the same organ can contain very different cancer subtypes.',
        tableData: {
          headers: ['Family', 'Examples', 'Research Focus'],
          rows: [
            ['Carcinomas', 'Breast, lung, colorectal, prostate, pancreas, liver, stomach, bladder, kidney, thyroid, head and neck, cervical, uterine, ovarian', 'Stage, histology, grade, biomarkers, operability, recurrence risk, local versus systemic therapy'],
            ['Sarcomas', 'Osteosarcoma, Ewing sarcoma, chondrosarcoma, leiomyosarcoma, liposarcoma, angiosarcoma, rhabdomyosarcoma, GIST', 'Expert pathology, imaging before biopsy when possible, margins, subtype-specific systemic therapy, specialty center review'],
            ['Blood and immune cancers', 'Leukemia, lymphoma, multiple myeloma, MDS, MPN', 'Blood counts, marrow, flow cytometry, cytogenetics, molecular profile, measurable residual disease, transplant or cellular therapy fit'],
            ['Brain and nervous system', 'Glioblastoma, astrocytoma, oligodendroglioma, ependymoma, medulloblastoma, meningioma, primary CNS lymphoma', 'MRI, surgical pathology, grade, IDH, 1p/19q, MGMT, neurologic function, radiation, trials'],
            ['Skin cancers', 'Melanoma, basal cell carcinoma, squamous cell carcinoma, Merkel cell carcinoma, cutaneous lymphoma', 'Lesion change, biopsy, depth or local invasion, nodal risk, UV exposure, BRAF/NRAS/KIT in selected melanoma, immunotherapy'],
            ['Pediatric and rare cancers', 'Neuroblastoma, Wilms tumor, retinoblastoma, hepatoblastoma, adrenal cortical carcinoma, thymic tumors, mesothelioma, ocular melanoma', 'Specialty review, age-specific protocols, rare tumor networks, genetic risk, trials'],
          ],
        },
      },
      {
        title: 'Research Questions',
        content:
          'Before comparing treatments or papers, capture the basics. Missing stage, subtype, or biomarker data can make a confident answer unsafe.',
        bulletPoints: [
          'What is the exact diagnosis, body site, and histology?',
          'Has pathology been reviewed, especially for rare cancer, sarcoma, lymphoma, or unusual findings?',
          'What is the stage, grade, risk group, and spread pattern?',
          'Which biomarkers or inherited risk tests are known, unknown, pending, or not applicable?',
          'Is the goal cure, control, symptom relief, prevention of recurrence, surveillance, or trial matching?',
        ],
      },
      {
        title: 'Primary Sources',
        content:
          'The full dated report lives at docs/wiki/all-cancers-research-atlas-2026-06-08.md and should be refreshed against official sources before clinical or product-policy use.',
        bulletPoints: [
          'NCI Cancer Types: https://www.cancer.gov/types',
          'NCI Cancer Causes and Prevention: https://www.cancer.gov/about-cancer/causes-prevention',
          'NCI Cancer Staging: https://www.cancer.gov/about-cancer/diagnosis-staging/staging',
          'WHO Cancer fact sheet: https://www.who.int/news-room/fact-sheets/detail/cancer',
        ],
      },
    ],
  },
  {
    id: 'cancer-screening-prevention-risk-guide',
    title: 'Cancer Screening, Prevention, And Risk Guide',
    subtitle: 'How to separate prevention, screening, symptoms, and diagnostic workups without turning general guidance into medical advice.',
    category: 'health',
    icon: 'HX',
    color: '#ef4444',
    tags: ['cancer', 'screening', 'prevention', 'risk', 'cdc', 'uspstf', 'health-safety'],
    content: [
      {
        title: 'Keep The Lanes Separate',
        content:
          'Prevention lowers risk before cancer develops. Screening looks for cancer or precancer before symptoms. Diagnostic testing investigates symptoms or abnormal screening results. Mixing these lanes creates unsafe answers.',
        bulletPoints: [
          'General screening guidance is not a personalized plan',
          'Symptoms require clinical evaluation, not a screening shortcut',
          'Risk can change with family history, genetics, prior results, immune status, anatomy, age, and exposures',
        ],
      },
      {
        title: 'Major Prevention Levers',
        content:
          'The strongest prevention content should focus on evidence-backed risk reduction and avoid cure-all claims.',
        tableData: {
          headers: ['Lever', 'Why It Matters'],
          rows: [
            ['Avoid tobacco and secondhand smoke', 'Tobacco is linked with many cancers, especially lung cancer and several head, neck, bladder, pancreas, kidney, cervix, stomach, liver, colorectal, and blood cancers.'],
            ['HPV vaccination and screening', 'HPV vaccination lowers risk for HPV-related cancers, while cervical screening still matters for age-eligible people.'],
            ['Hepatitis B vaccination and hepatitis care', 'Hepatitis B and C can raise liver cancer risk. Vaccination, testing, and treatment can reduce preventable harm.'],
            ['UV protection', 'UV exposure raises risk for melanoma and nonmelanoma skin cancers.'],
            ['Alcohol, weight, activity, and nutrition', 'Alcohol, obesity, and inactivity are population-level risk factors for multiple cancers.'],
            ['Occupational and environmental controls', 'Asbestos, radon, certain chemicals, ionizing radiation, and workplace exposures require practical risk controls.'],
          ],
        },
      },
      {
        title: 'Screening Snapshot',
        content:
          'Use current guideline sources before giving exact age or interval details. These examples reflect major U.S. screening lanes and should be personalized by a clinician.',
        bulletPoints: [
          'Breast: USPSTF recommends biennial mammography for women ages 40 to 74',
          'Colorectal: USPSTF recommends screening adults ages 45 to 75 with accepted stool, scope, or imaging strategies',
          'Cervical: screening depends on age, HPV/cytology strategy, cervix status, and prior results',
          'Lung: USPSTF recommends annual low-dose CT for ages 50 to 80 with a 20 pack-year smoking history who currently smoke or quit within 15 years',
          'Prostate: PSA screening is an individual decision for ages 55 to 69 and is not routinely recommended at age 70 or older',
        ],
      },
      {
        title: 'Agent Guardrails',
        content:
          'When a prompt asks about cancer prevention or symptoms, the chat should be calm, useful, and bounded.',
        bulletPoints: [
          'Do not diagnose from symptoms',
          'Do not tell users to delay biopsy, imaging, prescribed treatment, or urgent care',
          'Do link to CDC, USPSTF, NCI, WHO, and clinician review',
          'Do flag persistent bleeding, unexplained weight loss, new lumps, changing lesions, neurologic symptoms, or severe new symptoms for medical attention',
        ],
      },
      {
        title: 'Primary Sources',
        content:
          'The full dated report lives at docs/wiki/cancer-screening-prevention-and-risk-guide-2026-06-08.md.',
        bulletPoints: [
          'CDC Cancer Prevention: https://www.cdc.gov/cancer/prevention/',
          'CDC Cancer Screening: https://www.cdc.gov/cancer/prevention/screening.html',
          'USPSTF Cancer Screening Topics: https://www.uspreventiveservicestaskforce.org/uspstf/recommendation-topics/cancer',
          'NCI Risk Factors: https://www.cancer.gov/about-cancer/causes-prevention/risk',
        ],
      },
    ],
  },
  {
    id: 'cancer-diagnosis-staging-biomarkers-treatment',
    title: 'Cancer Diagnosis, Staging, Biomarkers, And Treatment',
    subtitle: 'A practical guide to the oncology evidence loop: pathology, stage, grade, molecular data, treatment families, and proof.',
    category: 'health',
    icon: 'HX',
    color: '#ef4444',
    tags: ['cancer', 'diagnosis', 'staging', 'biomarkers', 'treatment', 'oncology', 'clinical-trials'],
    content: [
      {
        title: 'Evidence Loop',
        content:
          'The safest research path is not cancer name to treatment. It is presentation, diagnostic workup, tissue diagnosis, stage, grade, biomarkers, treatment goal, and verification.',
        bulletPoints: [
          'Stage often changes the purpose and sequence of treatment',
          'Grade and histology can change risk and treatment intensity',
          'Biomarkers can guide targeted therapy, immunotherapy, inherited-risk counseling, and trial matching',
        ],
      },
      {
        title: 'Biomarker Map',
        content:
          'Biomarkers are context-dependent. A marker that matters in one cancer may be irrelevant in another.',
        tableData: {
          headers: ['Type', 'Examples', 'Use'],
          rows: [
            ['Blood tumor markers', 'PSA, CA-125, CA 19-9, CEA, AFP, beta-hCG, LDH, thyroglobulin', 'Sometimes useful for monitoring or selected workups, but many are not general screening tests.'],
            ['Hormone receptors', 'ER, PR, androgen receptor', 'Can guide endocrine or hormone-directed therapy.'],
            ['Targetable genes and fusions', 'BRCA1/2, KRAS, NRAS, BRAF, EGFR, ALK, ROS1, RET, NTRK, IDH, KIT, PDGFRA', 'Can change therapy options, inherited-risk questions, or trial matching.'],
            ['Immune and repair markers', 'MSI, mismatch repair, tumor mutational burden, PD-L1', 'Can help identify immunotherapy relevance in selected settings.'],
            ['Blood cancer markers', 'Flow cytometry, cytogenetics, BCR-ABL, FLT3, NPM1, JAK2, myeloma cytogenetics', 'Can define subtype, prognosis, measurable residual disease, and treatment choices.'],
          ],
        },
      },
      {
        title: 'Treatment Families',
        content:
          'Treatment families include surgery, radiation, chemotherapy, immunotherapy, targeted therapy, hormone therapy, stem cell transplant, interventional/local therapy, supportive and palliative care, surveillance, and clinical trials.',
        bulletPoints: [
          'The same treatment can be curative, adjuvant, palliative, or disease-controlling depending on context',
          'Supportive and palliative care can run alongside active treatment',
          'Clinical trials are especially important in rare, advanced, recurrent, or biomarker-defined cancers',
        ],
      },
      {
        title: 'Source Quality Check',
        content:
          'Cancer articles should be checked against their population, endpoint, comparison group, and harms. A cell study, animal study, phase 1 study, randomized trial, guideline, and marketing page do not carry the same weight.',
        bulletPoints: [
          'Ask what exact subtype and stage the source covers',
          'Ask whether outcomes include survival, response, symptoms, toxicity, or quality of life',
          'Ask whether the finding applies to the user age, biomarkers, prior treatments, and health context',
        ],
      },
      {
        title: 'Primary Sources',
        content:
          'The full dated report lives at docs/wiki/cancer-diagnosis-staging-biomarkers-and-treatment-guide-2026-06-08.md.',
        bulletPoints: [
          'NCI Cancer Staging: https://www.cancer.gov/about-cancer/diagnosis-staging/staging',
          'NCI Tumor Markers: https://www.cancer.gov/about-cancer/diagnosis-staging/diagnosis/tumor-markers-fact-sheet',
          'NCI Biomarker Testing: https://www.cancer.gov/about-cancer/treatment/types/biomarker-testing-cancer-treatment',
          'NCI Treatment Types: https://www.cancer.gov/about-cancer/treatment/types',
        ],
      },
    ],
  },
  {
    id: 'cancer-clinical-trials-care-navigation',
    title: 'Cancer Clinical Trials And Care Navigation',
    subtitle: 'A records checklist, clinical-trial primer, source hierarchy, and misinformation filter for cancer research tasks.',
    category: 'health',
    icon: 'HX',
    color: '#ef4444',
    tags: ['cancer', 'clinical-trials', 'care-navigation', 'oncology', 'records', 'misinformation'],
    content: [
      {
        title: 'Records First',
        content:
          'Trial matching and treatment research need the same core records: pathology, stage, scans, biomarkers, treatment history, response, side effects, current medications, health conditions, genetics when relevant, and practical constraints.',
        bulletPoints: [
          'Do not treat a trial listing as relevant until eligibility is checked',
          'Capture prior lines of therapy and dates',
          'Include travel, cost, caregiving, work, and support constraints',
        ],
      },
      {
        title: 'Trial Concepts',
        content:
          'Trials are research studies, not automatic proof that an approach works for a specific person.',
        tableData: {
          headers: ['Concept', 'Meaning'],
          rows: [
            ['Phase 1', 'Tests safety, dose, and early signals.'],
            ['Phase 2', 'Tests activity in a more defined group.'],
            ['Phase 3', 'Compares a new approach against a standard approach in a larger group.'],
            ['Eligibility', 'Defines who can join based on cancer type, stage, biomarkers, prior treatment, organ function, age, and health.'],
            ['Endpoint', 'Defines what the study measures, such as safety, response, survival, symptoms, or quality of life.'],
          ],
        },
      },
      {
        title: 'Credible Source Hierarchy',
        content:
          'The strongest personal guidance comes from the treating oncology team and tumor board. Public sources like NCI, CDC, NIH, WHO, USPSTF, FDA, guidelines, peer-reviewed studies, and trial registries help users prepare questions and compare evidence.',
        bulletPoints: [
          'Use news, blogs, social media, and clinic marketing as leads to better sources, not as proof',
          'Verify trial status and eligibility through official registries and trial teams',
          'Ask what the standard option is if the user does not enroll',
        ],
      },
      {
        title: 'Misinformation Filter',
        content:
          'Escalate claims that advertise one cure for all cancers, require buying a supplement or secret protocol, rely only on testimonials, tell users to abandon care, or cite cell and animal studies as direct proof of human cure.',
        bulletPoints: [
          'Reject cure-all framing',
          'Reject advice to delay urgent care or prescribed therapy',
          'Ask for human evidence, comparison groups, harms, endpoints, and independent review',
        ],
      },
      {
        title: 'Primary Sources',
        content:
          'The full dated report lives at docs/wiki/cancer-clinical-trials-and-care-navigation-2026-06-08.md.',
        bulletPoints: [
          'NCI Clinical Trials: https://www.cancer.gov/research/participate/clinical-trials',
          'NCI Find Cancer Clinical Trials: https://www.cancer.gov/research/participate/clinical-trials/search',
          'ClinicalTrials.gov: https://clinicaltrials.gov/',
          'NCI Questions to Ask about Treatment: https://www.cancer.gov/about-cancer/treatment/questions',
        ],
      },
    ],
  },
  {
    id: 'cancer-decision-support-self-advocacy',
    title: 'Cancer Decision Support And Self-Advocacy',
    subtitle: 'A shared decision-making toolkit for comparing cancer options, preparing appointments, seeking second opinions, and naming personal priorities.',
    category: 'health',
    icon: 'HX',
    color: '#ef4444',
    tags: ['cancer', 'decision-support', 'self-advocacy', 'shared-decision-making', 'second-opinion', 'questions'],
    content: [
      {
        title: 'Decision Frame',
        content:
          'The best cancer decision is the one that fits the evidence, the exact cancer situation, the user values, practical limits, and clinician review. The chat should help users prepare for shared decision-making, not choose treatment for them.',
        bulletPoints: [
          'Capture medical facts: cancer type, stage, grade, subtype, biomarkers, and treatment line',
          'List all reasonable options, including standard care, trials, monitoring, symptom-focused care, or no immediate treatment when appropriate',
          'Compare benefits, harms, timing, logistics, proof, and follow-up',
          'Ask what outcome matters most to the user',
        ],
      },
      {
        title: 'Option Comparison',
        content:
          'Every option should be compared across the same fields so users can see tradeoffs instead of only hearing a recommendation.',
        tableData: {
          headers: ['Field', 'What To Capture'],
          rows: [
            ['Goal', 'Cure, control, symptom relief, recurrence prevention, surveillance, clinical trial, or another goal'],
            ['Benefit', 'Expected result and how it is measured: response, survival, symptoms, function, quality of life, or recurrence risk'],
            ['Harms', 'Common side effects, serious risks, late effects, recovery, fertility, cognition, function, appearance, and independence'],
            ['Logistics', 'Visit schedule, treatment length, travel, caregiver needs, work/school disruption, and monitoring'],
            ['Cost', 'Coverage, prior authorization, in-network status, out-of-pocket estimate, assistance, and appeal path'],
            ['Fallback', 'What happens if the option does not work, causes too much toxicity, or the user changes goals'],
          ],
        },
      },
      {
        title: 'Questions To Bring',
        content:
          'A useful cancer decision aid turns confusion into direct questions for the oncology team.',
        bulletPoints: [
          'What information is still missing before we decide?',
          'How urgent is this decision, and is it safe to wait for biomarkers, scans, fertility planning, or a second opinion?',
          'What do you recommend and why does it fit my cancer and my goals?',
          'What are the most common side effects and which symptoms require calling immediately?',
          'How will this affect work, caregiving, fertility, sex, cognition, mobility, eating, sleep, pain, or independence?',
          'Is a clinical trial reasonable for me?',
        ],
      },
      {
        title: 'Second Opinion Signals',
        content:
          'Second opinions can be especially valuable for rare, aggressive, advanced, recurrent, uncertain, or high-stakes cancers, and when several reasonable options exist.',
        bulletPoints: [
          'Gather pathology, imaging, biomarker, genetic, lab, medication, and treatment-history records',
          'Ask the second-opinion team the exact question you want answered',
          'Do not let a second opinion delay urgent care unless the care team says waiting is safe',
        ],
      },
      {
        title: 'Primary Sources',
        content:
          'The full dated toolkit lives at docs/wiki/cancer-decision-support-and-self-advocacy-toolkit-2026-06-08.md.',
        bulletPoints: [
          'NCI Shared Decision Making: https://www.cancer.gov/publications/dictionaries/cancer-terms/def/shared-decision-making',
          'NCI Questions to Ask about Cancer: https://www.cancer.gov/about-cancer/coping/questions',
          'NCI Questions to Ask about Treatment: https://www.cancer.gov/about-cancer/treatment/questions',
          'NCI Finding Cancer Care: https://www.cancer.gov/about-cancer/managing-care/finding-cancer-care',
          'ACS Understanding Treatment Options: https://www.cancer.org/cancer/managing-cancer/making-treatment-decisions/making-decisions.html',
        ],
      },
    ],
  },
  {
    id: 'cancer-quality-life-financial-survivorship',
    title: 'Cancer Quality Of Life, Financial, And Survivorship Guide',
    subtitle: 'A whole-person guide to side effects, palliative care, costs, caregiver support, records, and life after treatment.',
    category: 'health',
    icon: 'HX',
    color: '#ef4444',
    tags: ['cancer', 'quality-of-life', 'financial-toxicity', 'survivorship', 'palliative-care', 'caregiver'],
    content: [
      {
        title: 'Whole-Person Decision Map',
        content:
          'Cancer decisions are not only about shrinking tumors. Users also need to understand symptoms, pain, function, mental health, family roles, work, cost, fertility, sexuality, caregiver needs, and life after treatment.',
        bulletPoints: [
          'Ask how each option affects daily life, work, caregiving, mobility, cognition, eating, sleep, pain, intimacy, and independence',
          'Track side effects and practical barriers early',
          'Treat financial and transportation problems as care issues, not side notes',
        ],
      },
      {
        title: 'Palliative Care Boundary',
        content:
          'Palliative care focuses on symptom relief, side effects, distress, social needs, spiritual concerns, caregiver strain, and practical problems. It can happen alongside cancer-directed treatment.',
        bulletPoints: [
          'Consider asking about palliative care for pain, nausea, fatigue, appetite loss, breathlessness, insomnia, neuropathy, distress, advanced disease, or hard tradeoffs',
          'Palliative care is not the same as giving up',
          'The chat should explain the concept and suggest questions, not give medication orders',
        ],
      },
      {
        title: 'Financial Toxicity Questions',
        content:
          'Financial toxicity includes medical bills, drug costs, travel, lodging, childcare, lost income, debt, insurance problems, and skipped medication because of cost.',
        bulletPoints: [
          'Is the doctor, hospital, imaging center, lab, pharmacy, and treatment in network?',
          'What prior authorization is needed?',
          'What are the expected out-of-pocket costs?',
          'Are there copay, foundation, hospital charity, manufacturer, social-work, travel, lodging, or transportation resources?',
          'Who helps with insurance denials or appeals?',
        ],
      },
      {
        title: 'Survivorship And Records',
        content:
          'After treatment, users may need a survivorship plan covering follow-up visits, scans, labs, recurrence signs, late effects, primary care responsibilities, vaccines, rehab, mental health, work, and copies of treatment records.',
        tableData: {
          headers: ['Record', 'Why It Matters'],
          rows: [
            ['Pathology, stage, grade, subtype', 'Anchors future care and second opinions'],
            ['Surgery, radiation, and systemic therapy summaries', 'Shows what was done, when, and with what dose or regimen'],
            ['Biomarker and genetic test reports', 'Can guide future treatment, screening, family counseling, or trial matching'],
            ['Side-effect log', 'Helps the team identify urgent symptoms, patterns, and quality-of-life needs'],
            ['Insurance approvals, denials, and bills', 'Supports appeals, financial counseling, and cost tracking'],
          ],
        },
      },
      {
        title: 'Primary Sources',
        content:
          'The full dated guide lives at docs/wiki/cancer-quality-of-life-financial-and-survivorship-guide-2026-06-08.md.',
        bulletPoints: [
          'NCI Palliative Care: https://www.cancer.gov/about-cancer/advanced-cancer/care-choices/palliative-care-fact-sheet',
          'NCI Managing Cancer Costs: https://www.cancer.gov/about-cancer/managing-care/track-care-costs',
          'NCI Financial Toxicity: https://www.cancer.gov/about-cancer/managing-care/track-care-costs/financial-toxicity-pdq',
          'NCI Caregiver Support: https://www.cancer.gov/about-cancer/coping/caregiver-support',
          'NCI Survivorship Questions: https://www.cancer.gov/about-cancer/coping/survivorship/questions',
        ],
      },
    ],
  },
  {
    id: 'energy-materials-systems',
    title: 'Energy And Materials Systems',
    subtitle: 'A non-AI knowledge lane for batteries, renewables, manufacturing, materials, and climate technology.',
    category: 'energy-materials',
    icon: 'EM',
    color: '#22c55e',
    tags: ['energy', 'materials', 'renewables', 'batteries', 'manufacturing', 'climate-tech'],
    content: [
      {
        title: 'Why This Domain Belongs Here',
        content:
          'Energy and materials shape what is physically possible. They also teach product teams to reason about constraints: cost, manufacturability, supply chains, lifecycle impact, safety, reliability, and deployment environment.',
        bulletPoints: [
          'Track performance and cost together',
          'Separate lab results from deployable systems',
          'Connect material constraints to manufacturing and infrastructure',
        ],
      },
      {
        title: 'How Agents Should Use It',
        content:
          'Agents can use this lane for research comparison, opportunity mapping, design inspiration, and technical learning. They should avoid presenting unreviewed material claims as validated engineering recommendations.',
        bulletPoints: [
          'Use source-backed summaries',
          'Flag experimental maturity',
          'Prefer review queues before operational use',
        ],
      },
    ],
  },
  {
    id: 'nikola-tesla-projects-planetary-impact',
    title: 'Nikola Tesla Projects And Planetary Impact',
    subtitle: 'A grounded map of Tesla work in AC power, induction motors, high-frequency systems, wireless communication, remote control, and turbines.',
    category: 'energy-materials',
    icon: 'EM',
    color: '#22c55e',
    tags: [
      'nikola tesla',
      'tesla',
      'electricity',
      'ac power',
      'induction motors',
      'wireless power',
      'remote control',
      'grid',
      'climate tech',
      'energy',
      'infrastructure',
    ],
    content: [
      {
        title: 'Core Thesis',
        content:
          'The useful lesson from Nikola Tesla is systems engineering, not mythology. His strongest work connected generation, transmission, motors, lighting, high-frequency electronics, wireless signals, and remote control into whole operating systems. That same style of thinking helps modern teams build cleaner energy, resilient infrastructure, public technology, and safer automation.',
        bulletPoints: [
          'Build electrical systems end to end, from source to useful work',
          'Use efficient motors because motor-driven systems are a major global electricity load',
          'Treat wireless communication as public infrastructure for education, health, safety, and coordination',
          'Use remote control and robotics to keep people out of dangerous work',
          'Reject over-unity or free-energy claims unless they survive measurement, safety review, and independent replication',
        ],
      },
      {
        title: 'Project Map',
        content:
          'Tesla projects are most valuable when mapped to practical modern levers. AC power and induction motors are proven infrastructure. Wardenclyffe-scale wireless power remains unproven as a grid replacement, but wireless communication, targeted wireless power, and remote control became durable technology families.',
        tableData: {
          headers: ['Project', 'What It Explored', 'Modern Planetary Lever'],
          rows: [
            ['Polyphase AC power', 'Generators, transformers, transmission, motors, and lighting as one system', 'Move clean electricity from renewable and low-carbon sources to real demand'],
            ['Induction motor', 'Rotating magnetic fields and brushless AC motor operation', 'Improve pumps, fans, compressors, HVAC, appliances, irrigation, and factory drives'],
            ['Tesla coil and high-frequency systems', 'Resonance, high voltage, high frequency, lighting, and RF experiments', 'Teach electricity, improve RF/power-electronics literacy, and support targeted wireless-power research'],
            ['Wardenclyffe and wireless transmission', 'Global wireless communication and attempted wireless energy transmission', 'Build universal connectivity, emergency communications, low-power sensor networks, and carefully bounded wireless charging'],
            ['Radio-controlled teleautomaton', 'Remote control of a vessel with radio signals', 'Use robots and drones for inspection, disaster response, precision agriculture, and hazardous-site work'],
            ['Bladeless turbine and pump', 'Boundary-layer fluid behavior in disk turbines and pumps', 'Study niche low-maintenance pumps, microturbines, and waste-heat experiments with real efficiency data'],
          ],
        },
      },
      {
        title: 'How It Improves Lives',
        content:
          'The clearest Tesla-to-planet pathway is practical electrification. Cleaner grids, efficient motor systems, resilient communications, and remote inspection can reduce pollution, lower operating costs, improve safety, and bring useful infrastructure to underserved places.',
        bulletPoints: [
          'Expand clean power transmission and microgrids for schools, clinics, farms, homes, and transit',
          'Retrofit motor systems with efficient motors, variable-speed drives, better controls, and predictive maintenance',
          'Use wireless communication for rural access, public alerts, telemedicine, education, and disaster coordination',
          'Deploy supervised robots for dangerous inspection and repair work',
          'Teach the difference between inspiration, hypothesis, prototype, and deployable engineering',
        ],
      },
      {
        title: 'Evidence Boundary',
        content:
          'Tesla research attracts bad claims. The wiki should keep the real breakthroughs while filtering unsupported stories. Wardenclyffe was ambitious and historically important, but it was not completed as an industrial wireless power grid. Free energy should mean abundant renewable energy and fair access, not energy without source, loss, or cost.',
        bulletPoints: [
          'Cite patents, museum records, government energy data, standards bodies, and peer-reviewed engineering sources',
          'Distinguish wireless communication from wireless power',
          'Distinguish short-range resonant wireless power from planetary power broadcast',
          'Mark uncompleted projects as uncompleted',
          'Avoid using Tesla quotes unless the original publication is known',
        ],
      },
      {
        title: 'What To Build Or Research Next',
        content:
          'A Tesla-inspired Underground Circle program should focus on measurable public benefit: clean electrification maps, motor-efficiency retrofits, grid resilience planning, public communication infrastructure, robotics for inspection, and safe science education.',
        bulletPoints: [
          'Build a school lesson that maps AC grids, motors, wireless, robotics, and energy equity',
          'Create student projects for motor retrofits, microgrids, and remote inspection workflows',
          'Add research cards that label claims as proven, experimental, speculative, or false',
          'Let agents produce climate-impact checklists for electrification and motor-efficiency opportunities',
          'Use source, transmission, control, user benefit, safety, economics, and maintenance as the evaluation frame',
        ],
      },
      {
        title: 'Sources To Recheck',
        content:
          'The full dated report lives at docs/wiki/nikola-tesla-projects-planetary-impact-2026-06-01.md. Recheck these source families before expanding the article.',
        bulletPoints: [
          'Smithsonian AC induction motor: https://americanhistory.si.edu/collections/object/nmah_713594',
          'EIA electricity and Tesla history: https://www.eia.gov/energyexplained/electricity/ and https://www.eia.gov/kids/history-of-energy/famous-people/tesla.php',
          'Tesla Museum patents: https://tesla-museum.org/en/nikola-tesla-2/patents/',
          'Google Patents: US381968A, US382280A, US454622A, US645576A, US1119732A, US613809A, US1061206A',
          'Tesla Science Center Wardenclyffe: https://teslasciencecenter.org/history/tower/',
          'IEA motor-driven systems: https://www.iea.org/reports/energy-efficiency-policy-opportunities-for-electric-motor-driven-systems',
          'NREL transmission planning: https://www.nrel.gov/grid/transmission-planning.html',
        ],
      },
    ],
  },
  {
    id: 'nikola-tesla-systems-buildout-roadmap',
    title: 'Nikola Tesla Systems Buildout Roadmap',
    subtitle: 'A practical roadmap for turning Tesla-inspired systems thinking into motor audits, clean electrification, resilient grids, emergency communications, robotics, and safe science labs.',
    category: 'energy-materials',
    icon: 'EM',
    color: '#22c55e',
    tags: [
      'nikola tesla',
      'tesla systems',
      'motor audit',
      'electrification',
      'microgrid',
      'wireless power',
      'emergency communications',
      'robotics',
      'science education',
      'climate tech',
    ],
    content: [
      {
        title: 'Buildout Principle',
        content:
          'Tesla-inspired work should make useful energy, communication, motion, sensing, and automation cheaper, safer, cleaner, more resilient, and more available. The roadmap turns the historical research into practical projects with measurement, safety, and claim hygiene built in.',
        bulletPoints: [
          'Use proven AC, motor, communication, and remote-control ideas as infrastructure patterns',
          'Treat uncompleted wireless-power ambitions as research questions, not deployment claims',
          'Measure source energy, useful output, losses, safety, reliability, and public benefit',
          'Prefer projects that reduce bills, emissions, downtime, and danger for real communities',
        ],
      },
      {
        title: 'Seven Buildout Pillars',
        content:
          'The roadmap organizes Tesla-inspired work into seven practical pillars. Each pillar connects a historical Tesla theme to a modern public-benefit target.',
        tableData: {
          headers: ['Pillar', 'Modern Target', 'Public Benefit'],
          rows: [
            ['Clean electrification', 'Electrify heat, transport, tools, farms, schools, clinics, and industry where the grid is ready', 'Less pollution and better controllability'],
            ['Motor efficiency', 'Audit motors, pumps, fans, compressors, HVAC, controls, and maintenance', 'Lower bills, lower emissions, less downtime'],
            ['Grid reach and resilience', 'Transmission planning, HVDC where appropriate, microgrids, storage, demand response', 'Clean power reaches people reliably'],
            ['Universal communication', 'Rural broadband, public alerts, emergency mesh, local knowledge mirrors', 'Better access to education, health, coordination, and safety'],
            ['Targeted wireless power', 'Charging docks, sensors, robots, medical devices, and controlled power-beaming research', 'Power where wires or batteries are limiting'],
            ['Remote inspection robotics', 'Drones, underwater robots, field robots, and supervised autonomy', 'Fewer people in hazardous work'],
            ['Public science labs', 'Safe motors, fields, radio, wireless power, and grid simulations', 'Better technical literacy and fewer false claims'],
          ],
        },
      },
      {
        title: 'First Project: Motor Efficiency Audit Kit',
        content:
          'The fastest practical project is a motor audit kit. Electric motor-driven systems are a large electricity load, so even small improvements across pumps, fans, compressors, HVAC, irrigation, and factory drives can compound into major savings.',
        bulletPoints: [
          'Inventory motor horsepower or kW, load type, runtime, controls, utility rate, and criticality',
          'Flag variable-load systems as candidates for variable-frequency drives or better controls',
          'Check belts, bearings, alignment, lubrication, heat, vibration, trips, and process throttling',
          'Output a ranked action: meter, inspect, tune, add controls, replace, repair mechanical load, or leave unchanged',
          'Label savings confidence as measured, estimated, or unknown',
        ],
      },
      {
        title: 'Claim Triage',
        content:
          'Tesla topics should be classified before they are recommended. Proven inventions, evolved modern technologies, plausible niche ideas, experimental systems, uncompleted historical projects, unsupported claims, and false or unsafe claims should not be mixed together.',
        bulletPoints: [
          'Proven: AC induction motor, polyphase concepts, radio remote control patent',
          'Proven but evolved: AC transmission, high-frequency circuits, remote-control systems',
          'Experimental: optical power beaming, dynamic wireless EV charging, some wireless-power applications',
          'Uncompleted: Wardenclyffe as promised global wireless power infrastructure',
          'Unsupported or false: over-unity machines, unlimited free-energy extraction, perpetual motion',
        ],
      },
      {
        title: 'App Build Targets',
        content:
          'The full roadmap lives at docs/wiki/nikola-tesla-systems-buildout-roadmap-2026-06-01.md. The best next product work is to make the roadmap interactive in the wiki, schools, and agent research tools.',
        bulletPoints: [
          'Add a Tesla Systems Lab school path',
          'Add a motor-audit worksheet and calculator',
          'Add a source-backed Tesla claim checker',
          'Add microgrid and emergency-communications scenario templates',
          'Add prompt blocks for agents to produce electrification and motor-efficiency checklists',
        ],
      },
      {
        title: 'Sources To Recheck',
        content:
          'Use official and primary sources first. The buildout should stay tied to the companion report, energy agencies, patents, museums, standards, and serious engineering programs.',
        bulletPoints: [
          'Companion report: docs/wiki/nikola-tesla-projects-planetary-impact-2026-06-01.md',
          'Buildout roadmap: docs/wiki/nikola-tesla-systems-buildout-roadmap-2026-06-01.md',
          'IEA motor-driven systems: https://www.iea.org/reports/energy-efficiency-policy-opportunities-for-electric-motor-driven-systems',
          'EIA machine drives: https://www.eia.gov/todayinenergy/detail.php?id=13431',
          'NREL transmission planning: https://www.nrel.gov/grid/transmission-planning.html',
          'DARPA POWER: https://www.darpa.mil/news/2025/darpa-program-distance-record-power-beaming',
          'Tesla Science Center Wardenclyffe: https://teslasciencecenter.org/history/tower/',
        ],
      },
    ],
  },
  {
    id: 'nikola-tesla-operational-kits',
    title: 'Nikola Tesla Operational Kits',
    subtitle: 'Motor audits, claim triage, and a Tesla Systems Lab path for turning energy history into practical, safe, measurable projects.',
    category: 'energy-materials',
    icon: 'EM',
    color: '#22c55e',
    tags: [
      'nikola tesla',
      'tesla systems lab',
      'motor efficiency',
      'motor audit',
      'claim checker',
      'source checker',
      'wireless power safety',
      'schools',
      'energy education',
      'climate projects',
    ],
    content: [
      {
        title: 'What Was Added',
        content:
          'The Tesla wiki now has three operational kits that move beyond history: a motor efficiency audit worksheet, a claim triage and source checker, and a Tesla Systems Lab school path. The goal is to make Tesla-inspired work measurable, safe, source-backed, and useful for real communities.',
        bulletPoints: [
          'Motor audit kit: inventory motors, runtime, controls, symptoms, and savings opportunities',
          'Claim checker: classify Tesla claims as proven, evolved, niche, experimental, uncompleted, unsupported, or false/unsafe',
          'Systems Lab path: teach source-to-load thinking, motors, grids, wireless boundaries, robotics safety, and claim hygiene',
        ],
      },
      {
        title: 'Motor Audit Output',
        content:
          'The motor audit kit turns Tesla induction-motor history into a practical facility worksheet. It focuses on the whole motor system, including pumps, fans, compressors, controls, maintenance, load profile, and runtime.',
        bulletPoints: [
          'Collect motor rating, load type, runtime, load pattern, existing control, symptoms, utility rate, and criticality',
          'Score runtime, load variability, control mismatch, mechanical symptoms, energy exposure, and criticality',
          'Recommend meter, inspect, tune, add controls, replace, repair mechanical load, or leave unchanged',
          'Require qualified workers and lockout/tagout boundaries for electrical or maintenance work',
        ],
      },
      {
        title: 'Claim Checker Output',
        content:
          'The claim checker prevents Tesla content from collapsing into myth. It asks what was built, what was measured, what losses were included, whether replication exists, and which safety limits apply.',
        tableData: {
          headers: ['Class', 'Use'],
          rows: [
            ['Proven', 'Use as a reliable historical or engineering foundation'],
            ['Proven but evolved', 'Use with notes about how modern systems differ'],
            ['Plausible niche', 'Study in bounded cases with measurement'],
            ['Experimental', 'Track as research, not broad deployment'],
            ['Uncompleted', 'Study as history, do not present as delivered infrastructure'],
            ['Unsupported', 'Reject until stronger evidence exists'],
            ['False or unsafe', 'Reject and warn'],
          ],
        },
      },
      {
        title: 'Tesla Systems Lab',
        content:
          'The school path organizes the topic into eight lessons: source to useful work, AC and rotating fields, motor audits, grid resilience, wireless communication versus wireless power, remote-control robotics, claim triage, and a planetary benefit project.',
        bulletPoints: [
          'Keep activities low-voltage or simulated unless trained supervision exists',
          'Require source lists and evidence classes for claims',
          'Use local facilities as living systems: energy, safety, maintenance, people, cost, and resilience',
          'Export the final project as a research document with problem, people helped, measurement plan, safety boundary, and next step',
        ],
      },
      {
        title: 'Files',
        content:
          'These docs are the canonical operational extensions for the Tesla wiki cluster.',
        bulletPoints: [
          'docs/wiki/nikola-tesla-motor-efficiency-audit-kit-2026-06-01.md',
          'docs/wiki/nikola-tesla-claim-triage-and-source-checker-2026-06-01.md',
          'docs/wiki/nikola-tesla-systems-lab-school-path-2026-06-01.md',
          'docs/wiki/nikola-tesla-systems-buildout-roadmap-2026-06-01.md',
          'docs/wiki/nikola-tesla-projects-planetary-impact-2026-06-01.md',
        ],
      },
    ],
  },
  // ===========================================================================
  // FOUNDATIONS
  // ===========================================================================
  {
    id: 'ai-history-foundations',
    title: 'AI History & Foundations',
    subtitle: 'The major eras of AI and the core concepts that still shape modern models and agents.',
    category: 'foundations',
    icon: '::',
    color: '#14b8a6',
    tags: ['history', 'transformers', 'foundations', 'agents'],
    content: [
      {
        title: 'Why Foundations Matter',
        content:
          'An AI wiki cannot only cover what is new. If it does, it becomes a stream of launch notes instead of a durable knowledge system. Understanding symbolic AI, statistical machine learning, deep learning, transformers, foundation models, and the agent era makes modern products much easier to reason about. It also helps you separate what is structural from what is hype.',
        bulletPoints: [
          'Old ideas explain why modern systems behave the way they do',
          'History helps you separate durable progress from temporary hype',
          'Product decisions improve when you understand the underlying era shifts',
        ],
      },
      {
        title: 'The Major Eras',
        content:
          'The broad sequence is symbolic AI, statistical machine learning, deep learning, transformers, foundation models, and then agents. Symbolic AI emphasized hand-authored rules. Statistical learning emphasized data-driven prediction. Deep learning enabled representation learning at scale. Transformers became the dominant architecture for language and many multimodal systems. Foundation models generalized one large model across many tasks. Agents extend those models into systems that can use tools, remember context, and complete work over time.',
        bulletPoints: [
          'Symbolic AI: explicit rules and logic',
          'Statistical ML: learn patterns from data',
          'Deep learning: hierarchical representations',
          'Transformers: attention-first sequence modeling',
          'Foundation models: general-purpose pretrained systems',
          'Agents: tool-using task systems',
        ],
      },
      {
        title: 'The Most Durable Concepts',
        content:
          'Several ideas keep showing up regardless of which provider is winning a given month: transformers, pretraining, post-training, retrieval, tool use, memory, context engineering, and evals. These are the concepts that should stay evergreen in any serious AI knowledge base because they determine what systems can do, how reliable they are, and what kind of infrastructure they need.',
        bulletPoints: [
          'Pretraining builds general capability',
          'Post-training shapes behavior and alignment',
          'Retrieval grounds answers in external context',
          'Tool use turns a model into a more useful system',
          'Evals separate good demos from dependable products',
        ],
      },
      {
        title: 'Why This Matters For Product Builders',
        content:
          'If you understand the foundations, you stop making shallow product mistakes. You do not confuse a fluent answer with a reliable task completion. You do not assume model quality alone will fix missing runtime design. You know when retrieval, tools, approvals, or evals matter more than switching models.',
        bulletPoints: [
          'Good chat output is not the same as good agent execution',
          'Runtime quality matters as much as model quality',
          'Context and tool access shape the product more than many teams expect',
        ],
      },
    ],
  },
  // ===========================================================================
  // LANDSCAPE
  // ===========================================================================
  {
    id: 'ai-landscape-radar',
    title: 'AI Landscape Radar',
    subtitle: 'A current-state view of the most important AI themes, products, and shifts worth tracking now.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    tags: ['radar', 'agents', 'multimodal', 'open-source', 'product'],
    content: [
      {
        title: 'What Matters Most Right Now',
        content:
          'The center of gravity in AI has shifted from simple chatbot comparisons to dependable agent workflows. The highest-signal areas now are coding agents, agent runtime infrastructure, multimodal input and output, browser and computer-use systems, stronger open-weight models, and evaluation-driven reliability.',
        bulletPoints: [
          'Coding agents are now real product categories',
          'Runtime infrastructure matters as much as the model',
          'Multimodal capability is becoming a default expectation',
          'Browser/computer-use systems are moving from novelty toward utility',
        ],
      },
      {
        title: 'Coding Agents',
        content:
          'Coding agents are the clearest example of AI doing end-to-end work today. The leaders are not just autocomplete tools. They read codebases, plan changes, edit files, run commands, execute tests, and increasingly coordinate parallel work. This is one of the most mature and strategically important areas in current AI product design.',
        bulletPoints: [
          'OpenAI Codex',
          'Anthropic Claude Code',
          'Google Gemini CLI',
          'OpenSwan and self-hosted control-plane patterns',
        ],
      },
      {
        title: 'Open Models And Self-Hosting',
        content:
          'Open-weight models continue to matter because they change the deployment and cost landscape. For many workflows, teams now have serious alternatives to fully closed stacks. The families to watch most closely are Llama, Qwen, DeepSeek, Mistral, Gemma, and Phi.',
        bulletPoints: [
          'Open models matter for privacy, cost, and control',
          'The best open-weight families are now good enough for many serious tasks',
          'Model choice should follow workflow and infrastructure needs, not hype alone',
        ],
      },
      {
        title: 'What A Product Team Should Track',
        content:
          'A good AI product research loop should separate stable foundations from fast-moving changes. The stable layer includes transformers, retrieval, tool use, memory, and evals. The fast-moving layer includes top agent products, multimodal workflows, browser-use systems, and open-weight model releases. That split keeps a wiki useful instead of overwhelming.',
        bulletPoints: [
          'Keep foundations evergreen',
          'Track moving fronts in dated radar reports',
          'Map every big shift back to product implications',
        ],
      },
    ],
  },
  {
    id: 'top-coding-languages-2026',
    title: 'Top Coding Languages For Product Builders',
    subtitle: 'Which languages matter most right now, why rankings disagree, and how each one could improve this app.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    relatedLessonIds: [
      'ai-tech:ai-coding:top-coding-languages-2026',
      'ai-tech:ai-coding:language-strategy-for-products',
    ],
    tags: ['languages', 'typescript', 'python', 'go', 'rust', 'product strategy'],
    content: [
      {
        title: 'Why Language Rankings Disagree',
        content:
          'There is no single best leaderboard for programming languages because each source measures something different. Stack Overflow captures self-reported usage. GitHub captures repository and contribution activity. RedMonk blends code activity with developer discussion. TIOBE measures broader search, education, and vendor visibility. That is why Python, JavaScript, TypeScript, Java, C#, Go, and Rust can all look "top" depending on the lens.',
        bulletPoints: [
          'Stack Overflow 2024: JavaScript still leads broad reported usage',
          'GitHub Octoverse 2024: Python moved to number one on GitHub with TypeScript in third',
          'RedMonk January 2025: JavaScript, Python, and Java remain highly durable',
          'TIOBE 2026: Python stays first with C, Java, C++, C#, and JavaScript still prominent',
        ],
      },
      {
        title: 'The Languages That Matter Most',
        content:
          'For modern builders, the most strategically useful languages are not just the biggest by raw popularity. They are the languages with clear product roles. TypeScript and JavaScript dominate product surfaces and web/mobile development. Python dominates AI, notebooks, and data tooling. Go is excellent for compact services and infrastructure utilities. Rust is increasingly important where security and performance matter. Java and C# still matter for enterprise integration. Kotlin and Swift matter for deeper native mobile work. SQL matters because product intelligence lives in data models and queries.',
        tableData: {
          headers: ['Language', 'Where It Wins', 'What It Could Improve In This App'],
          rows: [
            ['TypeScript / JavaScript', 'UI, shared product logic, fast iteration', 'Keep the main app, dashboards, wiki, and school UX moving fast'],
            ['Python', 'AI, notebooks, education, data workflows', 'Power AI labs, school projects, research utilities, and agent tools'],
            ['Go', 'Small services, MCP servers, networking tools', 'Run bridge services, sync workers, and backend utility processes'],
            ['Rust', 'Safety and performance', 'Support future secure local runtimes and indexing layers'],
            ['Java / C#', 'Enterprise systems and integrations', 'Connect to school and institutional software ecosystems'],
            ['Kotlin / Swift', 'Native mobile depth', 'Improve device-specific features beyond Expo defaults'],
            ['SQL', 'Analytics, retrieval, personalization', 'Strengthen school progress, wiki discovery, and memory retrieval'],
          ],
        },
      },
      {
        title: 'The Best Strategy For Underground Circle',
        content:
          'The app should not chase language novelty. It should use the right language for each layer. TypeScript should stay the default for the product itself because this codebase already gets the compounding value of shared web and mobile logic. Python should be the main expansion language for AI learning, research notebooks, lightweight automations, and beginner-friendly projects. Go should power lean services and MCP infrastructure where operational simplicity matters. Rust should be reserved for places where memory safety or performance is a real product need rather than a branding decision.',
        bulletPoints: [
          'Keep the core app in TypeScript',
          'Use Python for AI education and experiments',
          'Use Go for services and infrastructure',
          'Use Rust only where safety or speed is genuinely the bottleneck',
        ],
      },
      {
        title: 'What To Build Next',
        content:
          'The clearest product move is to turn language strategy into a learning advantage. The school section should teach not only how to prompt AI, but how to choose the right language for the right job. The wiki should help users understand why a product might mix TypeScript, Python, SQL, and Go instead of pretending one language solves everything.',
        bulletPoints: [
          'Add beginner Python projects to the school section',
          'Add a language-strategy lesson for product design decisions',
          'Teach users how app, agent, and infrastructure layers use different tools',
          'Tie wiki articles directly to school lessons so the app feels like a connected learning system',
        ],
      },
    ],
  },
  {
    id: 'typescript-agent-best-practices',
    title: 'TypeScript Best Practices For Agents',
    subtitle: 'How contributing agents should write, review, and verify TypeScript in The Underground Circle.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['typescript', 'typescript strict', 'strict-mode', 'agents', 'react-native', 'expo', 'type-safety', 'verification'],
    content: [
      {
        title: 'Baseline For This App',
        content:
          'The Underground Circle uses Expo / React Native with TypeScript strict mode for the app. Agents should treat strict typing as the floor, keep pure runtime modules testable from smoke scripts, and run the narrow typecheck before handing work back.',
        bulletPoints: [
          'Keep `strict` enabled and do not loosen TypeScript settings to make an edit pass',
          'Use `npm run typecheck:app` for app-side changes',
          'Use `npm run typecheck:functions` when Supabase function or shared edge code changes',
          'Finish TypeScript changes with `git diff --check`',
        ],
      },
      {
        title: 'Type Safety Rules',
        content:
          'Agent code should make bad states difficult to represent. The strongest patterns are precise domain types, discriminated unions, boundary parsers, exhaustiveness checks, and type-only imports. Free-form strings should not be the only source of truth for route, bridge, provider, approval, or recovery state.',
        bulletPoints: [
          'Use `unknown` for untrusted input until it is narrowed',
          'Prefer discriminated unions for planner, bridge, approval, recovery, and execution states',
          'Use `satisfies` for checked config maps without losing literal inference',
          'Avoid `any`, `as any`, double casts, and non-null assertions unless the invariant is local and obvious',
          'Design indexed and optional access as if `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` were enabled',
        ],
      },
      {
        title: 'Boundary Parsing Pattern',
        content:
          'Every bridge response, provider payload, file upload manifest, URL param, local-storage read, or JSON parse should be validated once at the boundary. After that, downstream code should receive a typed value and should not repeat stringly typed checks.',
        codeExample: `type Surface = 'browser' | 'desktop' | 'file' | 'hybrid';

interface AutomationRequest {
  surface: Surface;
  userText: string;
  requiresApproval: boolean;
}

function isSurface(value: unknown): value is Surface {
  return value === 'browser' || value === 'desktop' || value === 'file' || value === 'hybrid';
}

function parseAutomationRequest(input: unknown): AutomationRequest | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as { surface?: unknown; userText?: unknown; requiresApproval?: unknown };

  if (!isSurface(value.surface)) return null;
  if (typeof value.userText !== 'string' || value.userText.trim().length === 0) return null;

  return {
    surface: value.surface,
    userText: value.userText.trim(),
    requiresApproval: value.requiresApproval === true,
  };
}`,
      },
      {
        title: 'Agent Runtime Modeling',
        content:
          'Automation code should return typed receipts, blockers, proof, and recovery options. Chat should render useful choices from structured data instead of parsing raw exception text.',
        bulletPoints: [
          'Return typed success and failure results from bridge and desktop app adapters',
          'Include stable error codes, retryability, user-action requirements, and proof paths',
          'Switch on discriminants and use a `never` exhaustiveness check',
          'Keep UI labels separate from runtime discriminants',
          'Map database rows into app DTOs before handing them to UI or planners',
        ],
      },
      {
        title: 'Verification Checklist',
        content:
          'A TypeScript change is not done when the editor looks quiet. Agents should prove the change with the smallest useful command set and call out any skipped coverage.',
        bulletPoints: [
          'Run `npm run typecheck:app` for app code',
          'Run the focused smoke test for changed planner, bridge, recovery, provider, approval, persistence, or route behavior',
          'Run `npm run typecheck:functions` for Supabase functions or shared edge code',
          'Run `git diff --check` before final handoff',
          'Document any forced cast, skipped smoke, or unresolved type-risk explicitly',
        ],
      },
      {
        title: 'Sources To Recheck',
        content:
          'The canonical agent document at docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md keeps the longer standard and source list. Recheck official TypeScript, TSConfig, typescript-eslint, Expo, and React TypeScript docs when changing the baseline.',
        bulletPoints: [
          'TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html',
          'TypeScript narrowing: https://www.typescriptlang.org/docs/handbook/2/narrowing.html',
          'TSConfig strictness: https://www.typescriptlang.org/tsconfig/strict.html',
          'typescript-eslint type-checked configs: https://typescript-eslint.io/users/configs/',
          'Expo TypeScript guide: https://docs.expo.dev/guides/typescript/',
          'React TypeScript guide: https://react.dev/learn/typescript',
        ],
      },
    ],
  },
  {
    id: 'agent-development-standards-index',
    title: 'Agent Development Standards Index',
    subtitle: 'Which coding, TypeScript, design, web-page, app automation, tool-contract, and UC style standards agents should read for each task.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: [
      'agent standards',
      'development standards',
      'coding standards',
      'typescript standards',
      'design standards',
      'web design standards',
      'app automation standards',
      'tool contract standards',
      'agents',
      'verification',
    ],
    content: [
      {
        title: 'Why The Index Exists',
        content:
          'The standards index gives agents a short routing layer before implementation. Instead of guessing which guide applies, agents can choose the coding, TypeScript, design, web-page, computer/app automation, tool-contract/eval, or local style standard that matches the task.',
        bulletPoints: [
          'Start with AGENTS.md and docs/AGENTS_ROADMAP.md',
          'Use docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md to choose the right standard',
          'Use the roadmap when ownership or guidance conflicts',
          'Keep app wiki standards mirrored with the canonical docs',
        ],
      },
      {
        title: 'Standards Map',
        content:
          'Each task type has a required reading set and a usual verification shape. This keeps broad agent work consistent across code, TypeScript, design, wiki, web-page, computer/app automation, and tool/eval changes.',
        tableData: {
          headers: ['Task', 'Read', 'Verify'],
          rows: [
            ['General code change', 'CODING_AGENT_BEST_PRACTICES', 'Focused smoke, typecheck:app, git diff --check'],
            ['TypeScript change', 'CODING + TYPESCRIPT_AGENT_BEST_PRACTICES', 'Focused smoke when behavior changes, typecheck:app'],
            ['Product UI or automation card', 'DESIGN_AGENT_BEST_PRACTICES + UC_STYLE_GUIDE', 'Typecheck plus focused UI/runtime smoke when available'],
            ['Web page or dashboard', 'MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE + DESIGN + UC_STYLE_GUIDE', 'Mobile/desktop review, accessibility pass, typecheck'],
            ['Browser, desktop, file, or app automation', 'AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE + CODING + TYPESCRIPT + DESIGN', 'Computer/app route smoke, app-family smoke when relevant, typecheck'],
            ['OpenSwan, bridge, MCP, or connected-agent tool contract', 'AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE + CODING + TYPESCRIPT + AUTOMATION', 'Tool-specific smoke, approval/recovery negative-path smoke, typecheck'],
            ['Standards wiki content', 'This index plus the topic guide', 'smoke:agent-standards-wiki, typecheck:app, git diff --check'],
          ],
        },
      },
      {
        title: 'Worktree Integration Checklist',
        content:
          'The standards registry also builds hidden worktree-quality and SwanBot/OpenSwan configuration checks for delegated agents. It uses git status --porcelain=v1 -uall path snapshots, starts from AGENTS.md plus the roadmap and stack reference, maps changed files to canonical owners, checks required worktree docs/scripts/ignore rules with buildOpenSwanWorktreeConfigSnapshot, flags duplicate-path and verification risk, and recommends the narrowest smoke before typecheck and git diff --check.',
        bulletPoints: [
          'Use buildAgentWorktreeQualityChecklist when a bounded file list or git status output is available',
          'Use buildAgentWorktreeQualityPromptBlock or pass changedPaths into applyAgentDevelopmentStandardsToPrompt when handing work to Codex, Claude Code, Cursor Composer, Gemini, or a custom connected agent',
          'Use buildOpenSwanWorktreeConfigSnapshot and formatOpenSwanWorktreeConfigPromptBlock before SwanBot/OpenSwan hands a repo or .openswan-worktrees checkout to a connected agent, or pass the snapshot as worktreeConfigSnapshot into the standards prompt helpers',
          'Managed terminal bridge launches append the hidden worktree config block through terminal-launch-utils when projectDir is this repo or an OpenSwan worktree',
          'Run check:openswan-worktree-config before risky connected-agent handoffs when checkout state matters',
          'Run check:openswan-lanes when SwanBot/OpenSwan/Chat work becomes broad so changes are grouped by delivery lane before review',
          'Run check:swanbot-chat:daily for normal SwanBot/OpenSwan/Chat development and check:swanbot-chat:release before a larger delivery',
          'Run smoke:openswan-lane-report after changing the lane model or its package scripts',
          'Run smoke:openswan-worktree-config when the worktree config helper, report script, package scripts, .gitignore runtime artifacts, or OpenSwan worktree notes change',
          'Prefer extending mapped owners such as genericAppNavigator, appAutomationControlSurfaces, chat planning/metadata, chat computer runtime, OpenSwan runtime, product UI, second brain/research, standards/wiki, package scripts, or agent-runtime SQL before creating another file',
          'Escalate to a new roadmap owner only when no existing owner fits the concern',
        ],
      },
      {
        title: 'Canonical Standards',
        content:
          'The current canonical standards are docs/CODING_AGENT_BEST_PRACTICES.md, docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md, docs/DESIGN_AGENT_BEST_PRACTICES.md, docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md, docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md, docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md, and docs/UC_STYLE_GUIDE.md.',
        bulletPoints: [
          'Coding: change shape, architecture, security, testing, review, handoff',
          'TypeScript: strict typing, boundary parsing, unions, React Native / Expo, verification',
          'Design: product flow, UX writing, design-system discipline, automation UI',
          'Modern web: page structure, responsive layout, accessibility, performance, forms, media',
          'Computer/app automation: browser, desktop, files, native apps, Adobe/CAD, bridge recovery, evidence, and connected-agent adapter buildout',
          'Tool contracts and evals: schemas, structured results, approval metadata, recovery, redaction, retryability, and negative-path coverage',
          'UC style: local tokens for color, typography, radius, buttons, inputs, cards, and dark surfaces',
        ],
      },
      {
        title: 'Conflict Rules',
        content:
          'The standards should reinforce each other. When they conflict, the most specific document wins for its domain, and docs/AGENTS_ROADMAP.md wins over all standards docs.',
        bulletPoints: [
          'TypeScript-specific guidance wins over general coding guidance for TypeScript details',
          'Modern web guidance owns page structure and browser behavior',
          'Design guidance owns product flow, UX writing, and automation UI',
          'UC_STYLE_GUIDE owns local visual tokens',
          'AGENTS_ROADMAP wins when ownership or canonical architecture conflicts',
        ],
      },
      {
        title: 'Maintenance Contract',
        content:
          'When agents change these standards, they must keep the repo docs, app wiki, and verification smoke in sync so future agents see the same guidance everywhere.',
        bulletPoints: [
          'Update docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
          'Update AGENTS.md and docs/AGENTS_ROADMAP.md when discoverability or ownership changes',
          'Update the matching article in src/lib/wikiData.ts',
          'Update scripts/agent-standards-wiki-smoketest.ts',
          'Run npm run smoke:agent-standards-wiki, npm run typecheck:app, and git diff --check',
        ],
      },
    ],
  },
  {
    id: 'agentic-computer-app-automation-for-agents',
    title: 'Agentic Computer/App Automation For Agents',
    subtitle: 'How agents should route, approve, execute, recover, and verify browser, desktop, local-file, and native-app tasks.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: [
      'computer app automation',
      'desktop automation',
      'browser automation',
      'computer use',
      'photoshop',
      'indesign',
      'adobe',
      'cad',
      'bridge',
      'approval',
      'recovery',
      'agents',
    ],
    content: [
      {
        title: 'The Automation Standard',
        content:
          'Use docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md when a chat request should operate another browser, desktop app, uploaded file, local file, Adobe project, CAD drawing, bridge, or unfamiliar app. The standard is a semantic, evidence-first automation ladder, not a blind click loop.',
        bulletPoints: [
          'Classify the surface and risk before action',
          'Observe the browser, desktop, file, or app state before mutation',
          'Prefer official APIs, scripts, plugins, file adapters, semantic locators, and accessibility trees before coordinates',
          'Require approval for writes, exports, credentials, destructive actions, billing risk, private files, and low-confidence fallback',
          'Return typed receipts, before/after proof, warnings, and recovery options',
        ],
      },
      {
        title: 'Surface Ladder',
        content:
          'Agents should choose the safest deterministic control surface available. For Photoshop and InDesign this usually means UXP or scripting APIs before accessibility automation. For websites it means semantic Playwright or Browserbase routes before visual fallback. For unfamiliar apps it means app API, file format, accessibility tree, then connected-agent buildout.',
        tableData: {
          headers: ['Surface', 'Use First When', 'Fallback'],
          rows: [
            ['Product API or file adapter', 'The app exposes a documented API, SDK, script runtime, or parseable file format', 'Native app script bridge'],
            ['Native scripting or plugin API', 'Adobe, CAD, IDE, office, or design tools expose scripts/plugins/macros', 'Accessibility tree and menus'],
            ['Browser automation', 'The task is on a website or web app', 'CDP inspection or guarded visual fallback'],
            ['Desktop accessibility', 'The app lacks an API but exposes semantic UI controls', 'Coordinate fallback with approval'],
            ['Connected-agent buildout', 'No safe route exists yet', 'Stop with recovery options until proof exists'],
          ],
        },
      },
      {
        title: 'Typed Route Decision',
        content:
          'The helper buildAppAutomationRouteDecision(task, options) turns the research ladder into a compact execution gate. It returns ready_to_execute, needs_observation, needs_approval, needs_user_action, or needs_connected_agent_buildout before the chat mutates another app. formatAppAutomationRouteDecisionPromptBlock(decision) carries that decision into OpenSwan, SwanBot, Codex, Claude Code, Cursor Composer, or custom agents.',
        bulletPoints: [
          'Use the highest available deterministic surface and record stronger surfaces that were skipped',
          'Block execution when install, version, active document, locator, permission, file grant, or app evidence is missing',
          'Block writes, exports, uploads, generated scripts, destructive edits, and coordinates until approval exists',
          'Delegate missing adapters through connected-agent buildout only with official source refs, smoke proof, and a bounded retry plan',
        ],
      },
      {
        title: 'Approval And Evidence',
        content:
          'The chat should stay quiet until the user needs to approve, unblock, choose, or inspect proof. Any write, export, credential, billing, private-file, destructive, or coordinate-fallback action needs an approval payload that explains scope, change, proof, and stop conditions.',
        bulletPoints: [
          'Before evidence proves the target was identified',
          'Action receipts summarize commands, app operations, or browser steps',
          'After evidence proves the requested change or records manual verification needed',
          'Warnings list anything the agent could not verify',
          'Local paths and private content stay hidden unless explicitly needed',
        ],
      },
      {
        title: 'Failure Recovery',
        content:
          'Failures should become selectable recovery options instead of raw error text. Good options include retry with fresh evidence, repair or start the bridge, ask the user to unblock permissions/MFA/file access, switch surface, hand off adapter buildout to a connected agent, or stop and show details.',
        bulletPoints: [
          'Each option needs an actor, safety mode, retry cap, and stop condition',
          'Connected code agents build missing adapters only under a bounded scope',
          'A retry is not ready until the buildout result includes source refs, verification, and a safe plan',
          'Recovery context should include the failed message id, source surface, failure excerpt, and hidden guardrails',
        ],
      },
      {
        title: 'Research Basis',
        content:
          'The guide is grounded in current primary sources from Anthropic, MCP, NIST, OWASP, Playwright, Chrome DevTools Protocol, Apple UI scripting, Microsoft UI Automation, and Adobe UXP documentation.',
        bulletPoints: [
          'Anthropic agent and tool guidance: simple workflows first, clear tools, real evaluations, checkpoints, and stopping conditions',
          'MCP tools: visible tool exposure, human denial path, structured outputs, validation, access control, and sanitized outputs',
          'NIST AI RMF and OWASP: risk mapping, prompt injection, tool misuse, excessive agency, privilege abuse, data disclosure, and cascading failures',
          'Playwright, Apple, Microsoft, and Chrome: semantic locators, actionability checks, accessibility/control trees, and structured state before low-level fallback',
          'Adobe UXP: use documented Photoshop and InDesign scripting/plugin surfaces for layer, document, export, and text-frame work',
        ],
      },
      {
        title: 'Verification',
        content:
          'Agents should prove changes with the smallest command set that covers the risk. Standards/wiki edits need the standards smoke. Runtime app-automation changes need route, control-surface, evidence, and app-family smoke where relevant.',
        bulletPoints: [
          'Run npm run smoke:agent-standards-wiki for this article and the canonical guide',
          'Run npm run smoke:chat-computer-request-router for routing changes',
          'Run npm run smoke:app-automation-control-surfaces for control-surface metadata changes',
          'Run npm run smoke:computer-task-evidence-contract for proof and receipt changes',
          'Finish app-side changes with npm run typecheck:app and git diff --check',
        ],
      },
    ],
  },
  {
    id: 'agent-tool-contracts-and-evals-for-agents',
    title: 'Agent Tool Contracts And Evals For Agents',
    subtitle: 'How agents should design, review, approve, recover, redact, and evaluate OpenSwan, bridge, MCP, and connected-agent tools.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: [
      'tool contract',
      'agent tool evals',
      'mcp tool',
      'openswan tool',
      'bridge tool',
      'structured result',
      'approval metadata',
      'recovery eval',
      'redaction',
      'negative path',
      'agents',
    ],
    content: [
      {
        title: 'The Tool Standard',
        content:
          'Use docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md when a change touches OpenSwan tools, desktop/browser bridge tools, MCP tools, connected-agent dispatch, recovery actions, approval metadata, redaction, or tool result contracts. The concrete helper is src/lib/agentToolContractStandards.ts. Tools should be agent-facing contracts with clear names, bounded schemas, typed results, recovery options, and proof coverage.',
        bulletPoints: [
          'One tool should expose one clear capability',
          'Inputs should use strict schemas, enums, bounded strings, and required fields',
          'Results should separate completed, blocked, unsafe, and failed states',
          'Approval metadata should describe actor, target, risk, proof, retry limit, and stop condition',
          'Negative-path evals should prove malformed input, missing permission, unsafe action, redaction, and recovery behavior',
        ],
      },
      {
        title: 'Contract Checklist',
        content:
          'A reliable tool contract names the domain and action, states purpose, validates untrusted inputs, annotates risk, defines idempotency, requires observation before side effects, returns structured evidence, and redacts private output before it reaches chat or prompts.',
        tableData: {
          headers: ['Contract Area', 'Requirement'],
          rows: [
            ['Name and purpose', 'Namespaced imperative action with one clear capability'],
            ['Inputs', 'Strict schema, bounded fields, enums, and trust-boundary parsing'],
            ['Risk and approval', 'Read/write/destructive/billing/credential/privacy annotation plus user-visible approval rule'],
            ['Output shape', 'Stable completed, blocked, unsafe, and failed variants'],
            ['Evidence', 'Before/after state, receipts, diffs, exports, hashes, or manual-verification marker'],
            ['Eval coverage', 'Happy path plus malformed input, permission denial, unsafe target, redaction, retry, and prompt-injection cases'],
          ],
        },
      },
      {
        title: 'Typed Self Review',
        content:
          'The helper reviewAgentToolContractDraft(description, draft, options) checks a proposed tool before agents mark it ready. It blocks missing schema fields, missing approval gates, missing recovery fields, missing evals, and missing redaction coverage. formatAgentToolContractReviewPromptBlock(review) turns those findings into a compact connected-agent handoff.',
        bulletPoints: [
          'Ready tools include purpose, inputs, trust boundary, risk tags, approval rule, idempotency, observation, output variants, evidence, redaction, eval ids, recovery fields, and smoke commands',
          'Privileged tools are blocked unless approvalRequired is true',
          'Missing evals and recovery fields are blockers because chat cannot recover safely from prose-only failures',
          'Missing recommended smoke commands are warnings that need to be run or marked not applicable',
        ],
      },
      {
        title: 'Recovery Contract',
        content:
          'Recoverable failures need machine-readable fields so chat can show useful options without parsing prose. The recovery contract should include code, retryability, fresh-evidence requirement, approval requirement, actor, max attempts, recovery options, and stop condition.',
        bulletPoints: [
          'Retry only when idempotency or fresh evidence prevents duplicate side effects',
          'Ask the user only for real blockers such as permissions, MFA, app install, file access, or approval',
          'Use connected agents for bounded adapter or runtime repair with required proof',
          'Stop instead of looping when the target stays ambiguous or the action becomes unsafe',
        ],
      },
      {
        title: 'Research Basis',
        content:
          'The standard is grounded in primary guidance from Anthropic, MCP, NIST, and OWASP. The shared direction is clear: tools should be narrow, visible, validated, permissioned, structured, evaluated, and resistant to untrusted content overriding policy.',
        bulletPoints: [
          'Anthropic: design tools for agents, use clear namespaces and descriptions, return useful context, and test with real tasks',
          'MCP: tools are model-controlled capabilities that need visible exposure, user denial paths, structured outputs, input validation, access controls, rate limits, and sanitized output',
          'NIST AI RMF: map context, measure risk, manage mitigations, and keep review visible',
          'OWASP: defend against prompt injection, tool misuse, excessive agency, privilege abuse, data disclosure, supply-chain issues, and cascading failures',
        ],
      },
      {
        title: 'Verification',
        content:
          'Tool changes should prove both success and failure behavior. A passing happy path is not enough when the tool can touch files, browsers, apps, credentials, billing, connected agents, or recovery loops.',
        bulletPoints: [
          'Run npm run smoke:agent-tool-contract-standards for the reusable checklist and eval helper',
          'Run npm run smoke:agent-standards-wiki for this article and the canonical guide',
          'Run the tool-specific smoke for changed runtime behavior',
          'Run approval and recovery negative-path smoke when the tool is privileged',
          'Check redaction for secrets, private paths, screenshots, OCR, DOM, app state, and file snippets',
          'Finish app-side changes with npm run typecheck:app and git diff --check',
        ],
      },
    ],
  },
  {
    id: 'coding-best-practices-for-agents',
    title: 'Coding Best Practices For Agents',
    subtitle: 'A general engineering standard for agents writing, reviewing, testing, and handing off code.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: [
      'coding best practices',
      'code quality',
      'secure coding',
      'testing',
      'review',
      'agents',
      'handoff',
      'engineering standards',
    ],
    content: [
      {
        title: 'The General Code Standard',
        content:
          'Good code in this app should be clear, reviewable, tested at the right risk level, validated at trust boundaries, secure by default, observable enough to debug, and consistent with the canonical owner in the roadmap.',
        bulletPoints: [
          'Read the owning files and roadmap table before editing',
          'Extend existing helpers, types, adapters, and tests before adding parallel paths',
          'Keep changes small enough to review and roll back',
          'Separate refactors from behavior changes when practical',
          'Use docs/CODING_AGENT_BEST_PRACTICES.md as the full agent guide',
        ],
      },
      {
        title: 'Architecture And Boundaries',
        content:
          'Agents should keep side effects obvious and boundaries typed. UI can call runtime helpers, but generic logic should not import UI frameworks unless it is explicitly a UI helper.',
        bulletPoints: [
          'Keep adapters thin and translate boundary data into typed core logic',
          'Use one source of truth for route ids, provider ids, tool names, approvals, and statuses',
          'Do not hide file writes, network calls, bridge actions, database writes, or external app actions in formatters',
          'Validate configuration and boundary inputs before downstream code uses them',
        ],
      },
      {
        title: 'Security And Error Handling',
        content:
          'Secure coding is part of the agent standard because this app controls providers, browsers, files, desktop apps, memory, approvals, and user content. Unknown errors should become typed failures with safe user-facing recovery.',
        bulletPoints: [
          'Treat user input, provider output, uploaded files, bridge responses, URL params, local storage, and database rows as untrusted',
          'Use least privilege and allowlists for tools, routes, domains, app actions, and file operations',
          'Never log API keys, OAuth tokens, secret headers, private paths, or private file contents',
          'Fail closed for permissions, auth, destructive actions, billing risk, and unclear targets',
          'Return stable error codes when the UI or recovery layer needs to act',
        ],
      },
      {
        title: 'Testing And Verification',
        content:
          'Verification should match blast radius. A documentation-only change needs diff hygiene; planner, bridge, recovery, provider, approval, persistence, or route behavior needs focused smoke coverage plus typecheck.',
        tableData: {
          headers: ['Change Type', 'Expected Verification'],
          rows: [
            ['Documentation only', 'git diff --check'],
            ['App TypeScript or wiki data', 'npm run typecheck:app'],
            ['Supabase functions', 'npm run typecheck:functions'],
            ['Planner, route, recovery, bridge, provider, approval, persistence', 'Focused smoke plus npm run typecheck:app'],
            ['Security-sensitive logic', 'Negative-path smoke plus auth, redaction, and least-privilege review'],
          ],
        },
      },
      {
        title: 'Review And Handoff',
        content:
          'A useful agent handoff says what changed, where the canonical files are, what verification ran, what was skipped, and what risk remains. Review findings should lead with concrete bugs or regressions, not summaries.',
        bulletPoints: [
          'Check that the change solves the actual user request',
          'Call out unrelated or oversized diffs',
          'Check for validated inputs, typed recoverable errors, and approval-gated writes',
          'Check that secrets are redacted from logs, metadata, receipts, and chat',
          'Check that docs, wiki entries, or roadmap ownership are updated when behavior becomes canonical',
        ],
      },
      {
        title: 'Sources To Recheck',
        content:
          'The canonical coding guide keeps the full source list. Recheck engineering practice, secure coding, testing, and commit convention sources when changing the baseline.',
        bulletPoints: [
          'Google Engineering Practices: https://google.github.io/eng-practices/',
          'Google small changes: https://google.github.io/eng-practices/review/developer/small-cls.html',
          'OWASP secure coding: https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/stable-en/',
          'Testing Library principles: https://testing-library.com/docs/guiding-principles',
          'Conventional Commits: https://www.conventionalcommits.org/en/v1.0.0/',
        ],
      },
    ],
  },
  {
    id: 'modern-web-page-design-for-agents',
    title: 'Modern Web Page Design For Agents',
    subtitle: 'A practical standard for agents building useful, accessible, responsive, and performant developer-facing web pages.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: [
      'modern web design',
      'web page design',
      'responsive design',
      'accessibility',
      'wcag',
      'core web vitals',
      'agents',
      'developer ux',
    ],
    content: [
      {
        title: 'What Modern Means Here',
        content:
          'Modern web design is not trend-chasing. For this app, it means a page is useful, fast, readable, accessible, responsive, visually coherent, and honest about what the user can do.',
        bulletPoints: [
          'Start app/tool pages with the working interface, not a marketing hero',
          'Make the page purpose, current state, and primary action obvious',
          'Use the local UC style guide for color, typography, radius, buttons, cards, and inputs',
          'Design empty, loading, error, permission, and success states as part of the page',
        ],
      },
      {
        title: 'Page Build Blueprint',
        content:
          'A strong developer-facing page has a clear order: page purpose and state, primary action, real work area, supporting details, and recovery paths. This keeps agents from building decorative pages that do not help the user finish the job.',
        codeExample: `<main>
  <header>
    <h1>Page purpose</h1>
    <p>Current state or short value summary.</p>
    <div>{/* primary action, secondary action */}</div>
  </header>

  <section aria-labelledby="work-area-heading">
    <h2 id="work-area-heading">Work Area</h2>
    {/* tool, form, table, editor, preview, or task list */}
  </section>

  <aside aria-label="Supporting details">
    {/* filters, history, proof, metadata, or debug details */}
  </aside>
</main>`,
      },
      {
        title: 'Responsive And Accessible By Default',
        content:
          'Agents should build from semantic structure and content constraints. Components should reflow when content stops fitting, support keyboard and touch users, keep labels persistent, and respect browser zoom and reduced-motion preferences.',
        bulletPoints: [
          'Use one clear h1 and meaningful heading order',
          'Prefer responsive grids, minmax, clamp, max-width, aspect-ratio, and container-aware components',
          'Keep interactive elements keyboard reachable with visible focus states',
          'Use persistent form labels and recoverable inline validation',
          'Do not hide essential actions behind hover-only UI',
        ],
      },
      {
        title: 'Performance Is A Design Constraint',
        content:
          'Core Web Vitals are part of the design standard. Agents should prevent layout shift, avoid oversized assets, keep initial JavaScript small, and render useful loading or empty states instead of blank panels.',
        bulletPoints: [
          'Protect Largest Contentful Paint by prioritizing primary visible content',
          'Prevent Cumulative Layout Shift with image dimensions, aspect ratios, and stable placeholders',
          'Protect Interaction to Next Paint by avoiding unnecessary heavy client-side code',
          'Use responsive images and compress assets',
          'Do not add heavy animation, chart, editor, or 3D libraries unless the page truly needs them',
        ],
      },
      {
        title: 'Review Checklist',
        content:
          'A page is not ready just because it looks polished at one desktop width. Review it against real task completion, mobile layout, keyboard use, accessibility, performance, and local style consistency.',
        bulletPoints: [
          'The first screen shows the real workflow or a clear path to it',
          'Text wraps cleanly on mobile and with long labels',
          'Forms have labels, instructions, and recoverable errors',
          'Images have useful alt text or are marked decorative',
          'Cards are not nested inside cards and page sections are not fake floating cards',
          'The palette follows the UC style guide and does not become one-note',
          'Relevant typecheck or smoke tests and `git diff --check` pass',
        ],
      },
      {
        title: 'Sources To Recheck',
        content:
          'The canonical agent guide at docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md keeps the full standard. Recheck official web.dev, W3C WAI, MDN, NN/g, and Material accessibility references when changing the baseline.',
        bulletPoints: [
          'web.dev responsive design: https://web.dev/responsive-web-design-basics/',
          'web.dev Core Web Vitals: https://web.dev/articles/vitals',
          'W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/',
          'W3C WAI forms: https://www.w3.org/WAI/tutorials/forms/',
          'MDN CSS layout: https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout',
          'NN/g usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/',
        ],
      },
    ],
  },
  {
    id: 'design-best-practices-for-agents',
    title: 'Design Best Practices For Agents',
    subtitle: 'A product design and design-system standard for agents building screens, flows, and automation UI.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: [
      'design best practices',
      'product design',
      'design systems',
      'ux writing',
      'automation ui',
      'accessibility',
      'agents',
      'developer ux',
    ],
    content: [
      {
        title: 'The Product Design Standard',
        content:
          'Good product design in this app helps the user understand their state, see the next useful action, recover from failure, and trust what an agent changed. Visual style should serve task clarity and repeated use.',
        bulletPoints: [
          'Show state, purpose, and primary action on the first useful screen',
          'Reveal risk, approvals, blockers, and proof at the right time',
          'Support repeated work instead of only first-time discovery',
          'Use accessibility and responsive behavior as baseline requirements',
          'Use docs/DESIGN_AGENT_BEST_PRACTICES.md as the full agent guide',
        ],
      },
      {
        title: 'Start With The User Job',
        content:
          'Before creating UI, agents should name the user job, actor, object, action, proof of completion, and failure path. That keeps design work grounded in what the user is trying to finish.',
        bulletPoints: [
          'Primary actor: user, agent, connected agent, bridge, browser, app, or provider',
          'Primary object: message, file, app task, design asset, run, approval, wiki article, memory, provider, or automation',
          'Primary action: create, review, approve, retry, inspect, edit, export, connect, recover, or compare',
          'Proof: saved state, receipt, screenshot, file, export, run status, or visible UI change',
          'Failure path: retry, recover, ask user, switch route, stop, or show details',
        ],
      },
      {
        title: 'Design System Discipline',
        content:
          'Agents should use semantic tokens, local components, complete interaction states, and component variants before adding one-off styles. The UC style guide owns visual tokens; this article owns product design decisions.',
        bulletPoints: [
          'Use existing spacing, radius, typography, color, button, input, card, and modal patterns',
          'Cover default, hover, pressed, focused, selected, disabled, loading, empty, error, success, warning, and permission states',
          'Prefer variants over duplicated components',
          'Document why a new token or component is needed',
          'Do not create a new visual language for one feature unless it is intentionally a distinct mode',
        ],
      },
      {
        title: 'Automation UX',
        content:
          'AI and automation UI needs enough structure for trust without flooding the user. Chat should stay quiet by default, but approvals, recovery choices, proof, and blockers must be clear and selectable.',
        bulletPoints: [
          'Show compact route, approval, blocker, and proof summaries',
          'Hide raw prompts, local paths, run metadata, and stack traces behind details views',
          'Make recovery options selectable so the user does not rewrite failure context',
          'Make connected-agent handoffs explicit: actor, scope, retry limit, and stop condition',
          'Use receipts and before/after evidence for file, app, browser, and design automation',
        ],
      },
      {
        title: 'Design Review Checklist',
        content:
          'Review design work against task completion, clarity, consistency, accessibility, and recovery. A screen can look polished and still fail if it hides the workflow or omits states.',
        bulletPoints: [
          'The workflow is visible and not buried behind explanation',
          'Terminology is consistent for the same object or action',
          'Empty, loading, error, disabled, permission, and success states exist',
          'Controls do not jump when state changes',
          'Developer/debug details are not the default user experience',
          'The UI shows what the agent did and what proof exists',
        ],
      },
      {
        title: 'Sources To Recheck',
        content:
          'The canonical design guide keeps the full source list. Recheck product-design, design-system, accessibility, and token references when changing the baseline.',
        bulletPoints: [
          'NN/g usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/',
          'Figma components and shared libraries: https://www.figma.com/best-practices/components-styles-and-shared-libraries/',
          'Figma variables: https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma',
          'Figma design tokens: https://www.figma.com/resource-library/design-tokens/',
          'Material accessibility: https://m3.material.io/foundations/accessible-design/overview',
          'W3C WAI design tips: https://www.w3.org/WAI/tips/designing/',
        ],
      },
    ],
  },
  {
    id: 'python-study-bot-pattern',
    title: 'Python Study Bot Pattern',
    subtitle: 'How to design a simple command-line tutor that teaches product loops, scoring, and iteration.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    relatedLessonIds: [
      'ai-tech:python-project-lab:python-study-bot-cli',
    ],
    tags: ['python', 'cli', 'study bot', 'education', 'product loop'],
    content: [
      {
        title: 'Why A CLI Study Bot Is A Strong First Build',
        content:
          'A study bot is a strong beginner project because it contains a real product loop without needing a full interface stack. The user gives input, the program chooses content, the program evaluates answers, and the user gets feedback. That teaches much more than isolated syntax drills because it turns code into a usable tool.',
        bulletPoints: [
          'Input: user chooses a topic or starts a quiz',
          'Logic: the program selects questions and tracks score',
          'Output: the program gives feedback and a final result',
          'Iteration: the builder can add hints, retries, and saved progress',
        ],
      },
      {
        title: 'The Core Design Pattern',
        content:
          'The cleanest version of this project keeps the question bank simple and the control flow obvious. Start with a small list of questions, loop through them one at a time, compare answers, and print a summary. Do not hide the core loop behind too many abstractions at first. The point is to understand product flow and state clearly.',
        bulletPoints: [
          'Use a small question bank first',
          'Track score in one obvious place',
          'Return immediate feedback after each answer',
          'End with a summary the user can learn from',
        ],
      },
      {
        title: 'What To Improve After Version One',
        content:
          'Once the first version works, the most useful improvements are not flashy. Add answer normalization, optional hints, question difficulty, or a saved high score. Those changes teach iteration, user experience, and state handling, which are the real builder skills hidden inside a small tutorial project.',
        bulletPoints: [
          'Normalize user input before checking answers',
          'Add hints instead of only right/wrong outcomes',
          'Store simple progress or scores in a file',
          'Keep each improvement small and testable',
        ],
      },
    ],
  },
  {
    id: 'python-data-journal-pattern',
    title: 'Python Data Journal Pattern',
    subtitle: 'A beginner-friendly path from daily entries to useful summaries, trends, and product thinking.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    relatedLessonIds: [
      'ai-tech:python-project-lab:python-data-journal',
    ],
    tags: ['python', 'data journal', 'analytics', 'habits', 'product thinking'],
    content: [
      {
        title: 'Why This Project Matters',
        content:
          'A data journal teaches one of the most important lessons in software: information becomes useful when it is structured, stored, and summarized. This project is not just about files and lists. It is about turning repeated entries into a dashboard-like result a person can actually use.',
        bulletPoints: [
          'Collect a repeated kind of input',
          'Store it in a durable format',
          'Turn the raw entries into a useful summary',
          'Help the user see a pattern or make a decision',
        ],
      },
      {
        title: 'The Product Loop Inside The Project',
        content:
          'The hidden product pattern is simple but powerful: ask for a small piece of data, save it consistently, and later return an insight. That is the same pattern behind study tracking, mood journaling, recommendation systems, and progress dashboards. A beginner project like this quietly teaches the logic behind much larger products.',
        bulletPoints: [
          'Input capture matters',
          'Consistent data structure matters',
          'Summary logic creates value',
          'Insight is the bridge from data to product usefulness',
        ],
      },
      {
        title: 'What To Add Next',
        content:
          'After a first version, the strongest next steps are simple analytics improvements: weekly averages, streaks, tags, or a text summary that explains what changed over time. Later, a builder can imagine layering on AI for pattern explanation or coaching, but the first win is getting the data model and summary logic right.',
        bulletPoints: [
          'Add weekly or category averages',
          'Add highs, lows, or streak tracking',
          'Generate one short summary sentence from the data',
          'Keep AI as an optional later layer, not the first dependency',
        ],
      },
    ],
  },
  {
    id: 'python-mcp-tool-pattern',
    title: 'Python MCP Tool Pattern',
    subtitle: 'Designing one small Python capability that an AI system can call safely and usefully.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    relatedLessonIds: [
      'ai-tech:python-project-lab:python-mcp-starter',
    ],
    tags: ['python', 'mcp', 'tools', 'agent design', 'structured outputs'],
    content: [
      {
        title: 'Why Tools Matter More Than Prompts Alone',
        content:
          'A chat model can explain things, but a tool gives the model a capability. That is the key shift in agent design. A small Python tool that returns flashcards, a checklist, or a note summary teaches how AI systems become useful through actions and structured results, not just fluent text.',
        bulletPoints: [
          'Prompting shapes behavior',
          'Tools extend what the system can actually do',
          'Structured outputs make downstream use easier',
        ],
      },
      {
        title: 'The Smallest Useful Tool Design',
        content:
          'The best first tool does one thing well. Define its input clearly, keep the output structured, and make the boundary obvious. If a tool returns a study checklist, decide exactly what input it accepts, what shape the response uses, and what the tool should never touch. That is already real agent design.',
        bulletPoints: [
          'One clear capability',
          'One clear input contract',
          'One predictable output shape',
          'One explicit safety boundary',
        ],
      },
      {
        title: 'What Makes A Tool Safe And Reliable',
        content:
          'Good tool design includes limits. Decide whether the tool only reads data, whether it can write anything, and what should still require human approval. Reliability also improves when the tool returns structured values instead of an unbounded paragraph. The combination of clarity, boundaries, and structured output makes tool-using AI systems much easier to trust.',
        bulletPoints: [
          'Prefer read-only tools first',
          'Return structured data where possible',
          'Validate input before acting',
          'Keep sensitive actions behind approvals',
        ],
      },
    ],
  },
  {
    id: 'top-coding-agents',
    title: 'Top Coding Agents',
    subtitle: 'A practical overview of the most important coding-agent products and what makes them matter.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['coding agents', 'claude code', 'codex', 'openswan', 'gemini'],
    content: [
      {
        title: 'Why Coding Agents Matter',
        content:
          'Coding agents are one of the clearest examples of AI doing real end-to-end work. They do more than autocomplete. The best ones read project context, plan changes, edit files, run commands, execute tests, and make their work inspectable. This is one of the most important AI product categories for anyone building serious software tools.',
        bulletPoints: [
          'They operate over real project context',
          'They act instead of only answering',
          'They increasingly support parallel or longer-lived workflows',
        ],
      },
      {
        title: 'The Highest-Signal Products',
        content:
          'The most important coding-agent products right now include Claude Code, OpenAI Codex, Gemini CLI, and OpenSwan-style session and control-plane systems. They differ in product philosophy, ecosystem ties, and runtime design, but they all point toward the same broader shift: software work is moving from static assistance toward agentic execution.',
        bulletPoints: [
          'Claude Code emphasizes terminal-native flow and tooling depth',
          'Codex emphasizes software execution and cloud/local task handling',
          'Gemini CLI emphasizes Gemini access and large-context workflows',
          'OpenSwan emphasizes remote sessions and self-hosted control patterns',
        ],
      },
      {
        title: 'What The Best Ones Share',
        content:
          'The strongest coding-agent systems all make similar design choices. They expose a permission model, operate over project files and commands, maintain useful context, and show enough intermediate work for the user to trust what happened. This makes runtime quality more important than a simple list of headline features.',
        bulletPoints: [
          'Project awareness',
          'Permission and approval boundaries',
          'Actionability',
          'Traceability',
          'Workflow continuity',
        ],
      },
    ],
  },
  {
    id: 'multimodal-browser-agents',
    title: 'Multimodal & Browser Agents',
    subtitle: 'Why images, audio, screenshots, and browser actions are becoming core agent capabilities.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['multimodal', 'browser use', 'vision', 'audio', 'artifacts'],
    content: [
      {
        title: 'Beyond Text-Only Agents',
        content:
          'Many of the most useful modern AI workflows are no longer text-only. Agents increasingly need to interpret screenshots, transcribe audio, answer questions about images, generate assets, and validate behavior in a live browser. These capabilities change what a product can ask an agent to do and what proof an agent can return.',
        bulletPoints: [
          'Vision enables screenshot understanding and OCR',
          'Audio enables transcription and TTS workflows',
          'Image generation supports ideation and asset creation',
          'Browser-use enables validation and UI-only task completion',
        ],
      },
      {
        title: 'Why Browser-Use Matters',
        content:
          'A large amount of real work still happens inside websites and dashboards with weak or nonexistent APIs. Browser-capable agents help bridge that gap. They can navigate pages, collect evidence, validate flows, and sometimes complete repetitive actions that would otherwise require a human to click through them manually.',
        bulletPoints: [
          'Useful for UI validation',
          'Useful for legacy or API-poor systems',
          'Useful for proof-producing workflows',
        ],
      },
      {
        title: 'The Right Product Pattern',
        content:
          'Strong multimodal and browser-capable systems should return typed artifacts and traces, not just prose. That means screenshots, transcripts, extracted text, generated visuals, and step-by-step action logs should be part of the product model. Review checkpoints and validation loops matter just as much as generation itself.',
        bulletPoints: [
          'Typed artifacts build trust',
          'Action traces improve debuggability',
          'Validation loops reduce false confidence',
        ],
      },
    ],
  },
  {
    id: 'model-families-overview',
    title: 'Model Families Overview',
    subtitle: 'A practical map of the main model families shaping the current AI ecosystem.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['models', 'llama', 'gemma', 'mistral', 'deepseek', 'qwen'],
    content: [
      {
        title: 'Why Model Families Matter',
        content:
          'A good AI product strategy requires more than following whichever model is trending. Different model families change what is possible across cost, multimodal support, self-hosting, licensing, and runtime design. The important question is not just who is best overall. It is which family best fits the workflow and deployment shape you actually need.',
        bulletPoints: [
          'Capability is only one axis',
          'Cost and licensing matter',
          'Self-hosting and deployment options matter',
          'Model fit depends on workflow, not hype alone',
        ],
      },
      {
        title: 'The Families To Watch',
        content:
          'The most important families to keep tracking include OpenAI and Claude on the closed frontier side, plus Llama, Gemma, Qwen, DeepSeek, Mistral, and Phi on the open or open-weight side. Each family has a different strategic role in the ecosystem and a different practical role for builders.',
        bulletPoints: [
          'OpenAI models matter for frontier tooling and product integration',
          'Claude models matter for strong reasoning and agentic workflows',
          'Llama matters as a major open ecosystem anchor',
          'Gemma matters for Google-backed open development',
          'Qwen, DeepSeek, and Mistral matter heavily for open-weight capability and deployment choice',
        ],
      },
      {
        title: 'How To Compare Them Correctly',
        content:
          'The right comparison questions are simple: can it do the job, what inputs and outputs does it support, how expensive is it, can it be self-hosted, and what constraints come with its license or platform? Builders who focus only on benchmark headlines usually make worse product decisions than builders who compare workflows and infrastructure fit.',
        bulletPoints: [
          'Task fit beats benchmark obsession',
          'Deployment matters as much as raw quality',
          'Open vs closed tradeoffs should be explicit',
        ],
      },
    ],
  },
  {
    id: 'evals-ai-reliability',
    title: 'Evals & AI Reliability',
    subtitle: 'Why evaluation, regression testing, and workflow measurement matter more than AI demos.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['evals', 'reliability', 'benchmarks', 'agents'],
    content: [
      {
        title: 'Why Evals Matter',
        content:
          'Without evaluation, AI products become collections of anecdotes. A model or agent can look impressive in a few examples and still fail badly in production. Evals give teams a structured way to measure quality, compare versions, and prevent regressions from shipping unnoticed.',
        bulletPoints: [
          'Evals turn vibes into evidence',
          'They help catch regressions early',
          'They matter for safety as well as quality',
        ],
      },
      {
        title: 'The Important Layers',
        content:
          'There are multiple useful evaluation layers. Model evals compare broad capabilities. Workflow evals measure whether the actual product flow works. Safety evals measure harmful or policy-breaking behavior. Regression evals measure whether changes made the system worse. Serious AI products need more than one layer.',
        bulletPoints: [
          'Model evals',
          'Workflow evals',
          'Safety evals',
          'Regression evals',
        ],
      },
      {
        title: 'What To Measure For Agents',
        content:
          'For agent systems, practical measures often matter more than headline benchmark scores. Useful measures include task success rate, tool success rate, retry frequency, approval frequency, artifact quality, and how much human rework is still needed after the system says it is done.',
        bulletPoints: [
          'Task success rate',
          'Tool success rate',
          'Approval and retry patterns',
          'Artifact usefulness',
          'Human rework after completion',
        ],
      },
    ],
  },
  {
    id: 'retrieval-context-engineering',
    title: 'Retrieval & Context Engineering',
    subtitle: 'Why many AI failures are really context failures and how better context design fixes them.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['retrieval', 'context', 'embeddings', 'memory', 'rag'],
    content: [
      {
        title: 'Retrieval Vs Context Engineering',
        content:
          'Retrieval is about selecting relevant external information and bringing it into the model context when needed. Context engineering is broader. It is the discipline of deciding what the model sees, in what order, at what level of detail, and under what token and policy constraints. Retrieval is part of context engineering, not the whole thing.',
        bulletPoints: [
          'Retrieval selects useful evidence',
          'Context engineering designs the full input system',
          'Both strongly shape agent quality',
        ],
      },
      {
        title: 'Why It Matters So Much',
        content:
          'Many AI failures come from missing or noisy context rather than weak models. A strong model with the wrong context can still fail badly. Agents are especially context-sensitive because they work across multiple steps, tools, artifacts, and changing task state.',
        bulletPoints: [
          'Bad context can waste even strong models',
          'Agents need stable instructions and dynamic evidence',
          'Context should be layered, not dumped in blindly',
        ],
      },
      {
        title: 'Useful Product Pattern',
        content:
          'A strong context system usually separates stable instructions, dynamic task state, retrieved evidence, and output-aware continuation. That keeps prompts cleaner, makes retrieval more intentional, and helps future runs build on prior artifacts and summaries without collapsing into noise.',
        bulletPoints: [
          'Stable instruction layer',
          'Dynamic task layer',
          'Retrieved evidence layer',
          'Output-aware continuation layer',
        ],
      },
    ],
  },
  {
    id: 'browser-computer-use-ecosystem',
    title: 'Browser & Computer-Use Ecosystem',
    subtitle: 'How agents are moving from text generation into browser automation, screenshots, and interface control.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['browser', 'computer use', 'playwright', 'automation', 'screenshots'],
    content: [
      {
        title: 'Why This Area Matters',
        content:
          'A large amount of real work still happens inside websites, dashboards, and internal tools that do not expose clean APIs. Browser and computer-use systems matter because they let agents interact with those environments directly. This changes agents from pure responders into operators that can gather proof, validate flows, and complete interface-bound tasks.',
        bulletPoints: [
          'Useful for UI-only systems',
          'Useful for product QA and proof',
          'Useful for repetitive browser workflows',
        ],
      },
      {
        title: 'Two Main Modes',
        content:
          'There are two major patterns here. Deterministic browser automation tools, such as Playwright, are strong for repeatable flows and assertions. Computer-use tools are stronger when the task is more visual, less structured, or less predictable. The strongest future products will often combine both modes instead of choosing only one.',
        bulletPoints: [
          'Deterministic automation for repeatability',
          'Model-driven computer use for flexibility',
          'Hybrid systems are often strongest',
        ],
      },
      {
        title: 'The Safety Requirement',
        content:
          'This category is powerful but risky. Browser and computer-use systems need stronger approvals, action traces, and screenshot proof because they can interact with real credentials, real external systems, and real user interfaces. Safety here is mostly a product-design problem, not just a model problem.',
        bulletPoints: [
          'Approval gates matter',
          'Action logging matters',
          'Proof artifacts matter',
        ],
      },
    ],
  },
  {
    id: 'enterprise-agent-platforms',
    title: 'Enterprise Agent Platforms',
    subtitle: 'What enterprise agent systems optimize for beyond raw model quality.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['enterprise', 'copilot studio', 'agentforce', 'governance'],
    content: [
      {
        title: 'What Enterprise Teams Need',
        content:
          'Enterprise agent platforms are not only about impressive responses. They are about governance, integration, deployment control, analytics, approvals, and safe connections to real business systems. This is what makes enterprise agent design meaningfully different from consumer AI products.',
        bulletPoints: [
          'Governance',
          'Integration depth',
          'Analytics and observability',
          'Deployment and review control',
        ],
      },
      {
        title: 'The Core Platform Pattern',
        content:
          'The strongest enterprise platforms increasingly treat agents as bundles of instructions, knowledge sources, tools, flows, and approval boundaries. That structure matters because it separates grounded knowledge from action-taking capability and gives admins clearer control over what an agent can really do.',
        bulletPoints: [
          'Instructions',
          'Knowledge sources',
          'Tools and connectors',
          'Flows and approvals',
        ],
      },
      {
        title: 'Why It Matters To Builders',
        content:
          'Enterprise systems show that serious AI products need explicit capabilities, explicit knowledge boundaries, and measurable outcomes. That lesson applies even outside the enterprise. The same structure usually improves community, productivity, and team-workflow products too.',
        bulletPoints: [
          'Make capabilities explicit',
          'Separate knowledge from actions',
          'Track outcomes, not just outputs',
        ],
      },
    ],
  },
  {
    id: 'ai-safety-permission-patterns',
    title: 'AI Safety & Permission Patterns',
    subtitle: 'How strong AI products govern access, approvals, isolation, and trust.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['safety', 'permissions', 'approvals', 'trust', 'guardrails'],
    content: [
      {
        title: 'The Real Safety Question',
        content:
          'The real safety problem for agents is not just what they can say. It is what they can access, execute, mutate, and publish. That makes permission design a product-level system, not just a policy checkbox. Strong agent products govern capability, approvals, isolation, and traceability together.',
        bulletPoints: [
          'Safety is about access and action, not just content',
          'Permissions should match risk',
          'Traceability builds trust',
        ],
      },
      {
        title: 'The Key Layers',
        content:
          'The most important safety layers are capability scoping, approval tiers, isolation, traceability, and recovery. A good system decides which tools are active, which actions need approval, which environments are isolated, and how a user can inspect or undo what happened.',
        bulletPoints: [
          'Capability scoping',
          'Approval tiers',
          'Isolation',
          'Traceability',
          'Recovery',
        ],
      },
      {
        title: 'Why This Matters For Agents',
        content:
          'As agents get stronger, invisible execution becomes less acceptable. Users need clear boundaries and visible proof. The best products therefore shift trust away from hidden reasoning and toward visible actions, artifacts, and checks.',
        bulletPoints: [
          'Proof before trust',
          'Risk-based approvals',
          'Environment-specific guardrails',
        ],
      },
    ],
  },
  {
    id: 'open-source-model-serving-stack',
    title: 'Open Source Model Serving Stack',
    subtitle: 'How builders actually run models with open serving layers such as vLLM and TGI.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['serving', 'vllm', 'tgi', 'inference', 'self-hosting'],
    content: [
      {
        title: 'Why Serving Matters',
        content:
          'Model quality gets most of the attention, but the serving layer determines whether those models are practical. It shapes latency, throughput, observability, API compatibility, and deployment control. For product builders, serving is where model choice becomes operations.',
        bulletPoints: [
          'Latency and throughput matter',
          'API compatibility matters',
          'Operations matter',
        ],
      },
      {
        title: 'vLLM And TGI',
        content:
          'vLLM is one of the most important current open serving layers because it supports offline and online inference and exposes OpenAI-compatible serving. Hugging Face Text Generation Inference remains historically important, but the official Hugging Face docs now note that TGI is in maintenance mode and point developers toward engines such as vLLM and SGLang.',
        bulletPoints: [
          'vLLM is strategically important',
          'OpenAI-compatible serving reduces integration friction',
          'TGI is still useful context but no longer the center of future momentum',
        ],
      },
      {
        title: 'What Builders Should Evaluate',
        content:
          'The important questions are simple: can it serve the models you need, does it support your hardware, how easy is it to operate, and how much lock-in or integration friction does it create? Those questions matter more than chasing whichever engine sounds newest.',
        bulletPoints: [
          'Model support',
          'Hardware fit',
          'Operational complexity',
          'Future ecosystem direction',
        ],
      },
    ],
  },
  {
    id: 'design-to-code-figma-mcp',
    title: 'Design-to-Code & Figma MCP',
    subtitle: 'How AI agents are closing the loop between structured design context and implementation.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['figma', 'mcp', 'design-to-code', 'ui', 'implementation'],
    content: [
      {
        title: 'Why This Shift Matters',
        content:
          'Design-to-code is moving from screenshot interpretation toward structured design understanding. The more agents can read components, variables, layout data, and design-system structure directly, the less they need to guess from flat images and the more reliably they can implement real interfaces.',
        bulletPoints: [
          'Structured design context is stronger than screenshot-only context',
          'Design systems should stay the source of truth',
          'Design and code loops are getting tighter',
        ],
      },
      {
        title: 'Why Figma MCP Matters',
        content:
          'Figma MCP is one of the clearest official examples of this direction. Its documented workflows emphasize giving agents access to components, variables, layout information, and even write capabilities. That means design-aware agents can work from real system structure and not just visual approximation.',
        bulletPoints: [
          'Read structured design context',
          'Support implementation workflows',
          'Enable some write-back into design tooling',
        ],
      },
      {
        title: 'The Right Product Pattern',
        content:
          'The strongest design-to-code systems combine structured context, visual validation, and a bidirectional loop between design and implementation. The product goal should not just be code generation. It should be keeping design and code aligned over time.',
        bulletPoints: [
          'Structured context',
          'Visual checks',
          'Bidirectional design/code workflows',
        ],
      },
    ],
  },
  {
    id: 'ai-support-agent-patterns',
    title: 'AI Support-Agent Patterns',
    subtitle: 'How strong support agents combine grounded knowledge, escalation, and workflow handling.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['support', 'agentforce', 'routing', 'escalation', 'help'],
    content: [
      {
        title: 'Why Support Matters',
        content:
          'Support is one of the clearest places where AI either proves itself or breaks trust. Good support agents need grounded knowledge, workflow awareness, escalation rules, and continuity across channels. They are not just FAQ bots. They are case-handling and routing systems.',
        bulletPoints: [
          'Knowledge matters',
          'Escalation matters',
          'Continuity matters',
        ],
      },
      {
        title: 'The Key Pattern',
        content:
          'The strongest support systems combine a knowledge layer with a workflow layer. The knowledge layer answers questions. The workflow layer routes cases, requests more information, escalates to humans, and opens follow-up tasks. Without both, support agents stay shallow.',
        bulletPoints: [
          'Knowledge and workflow should be separate concepts',
          'Escalation should be first-class',
          'Summaries and handoff artifacts improve continuity',
        ],
      },
      {
        title: 'Why It Matters For Product Builders',
        content:
          'Support agents force teams to take grounding, trust, and measurement seriously. They are useful because they sit close to real user pain and real operational cost. That makes them one of the most important practical agent categories to study.',
        bulletPoints: [
          'Good support design improves both user experience and operations',
          'Support agents reveal where your runtime and knowledge design are weak',
        ],
      },
    ],
  },
  {
    id: 'multimodal-media-tooling',
    title: 'Multimodal Media Tooling',
    subtitle: 'How modern AI systems work with images, audio, transcripts, and reusable media artifacts.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['media', 'hf', 'image', 'audio', 'transcription'],
    content: [
      {
        title: 'Why Media Tooling Matters',
        content:
          'AI products are increasingly multimodal, which means they need to create, transform, and understand media rather than only generate text. This includes image generation, transcription, speech, visual understanding, translation, and classification.',
        bulletPoints: [
          'Media workflows change what outputs look like',
          'Typed artifacts become much more important',
          'Multimodal capability expands what agents can actually do',
        ],
      },
      {
        title: 'The Core Product Pattern',
        content:
          'The best multimodal systems expose media outputs as explicit artifacts with provenance, tool identity, and reuse paths. That means image cards, transcript cards, translation cards, and classification cards rather than burying tool output inside plain text.',
        bulletPoints: [
          'Typed artifacts',
          'Provenance',
          'Reusable outputs',
        ],
      },
      {
        title: 'Why Hugging Face Matters Here',
        content:
          'Hugging Face’s Inference Providers ecosystem is useful because it presents a unified interface across many multimodal task types and providers. That makes it easier to think about media capability as a product layer instead of a pile of one-off integrations.',
        bulletPoints: [
          'Unified interface across task types',
          'Broad provider coverage',
          'Good fit for capability-layer thinking',
        ],
      },
    ],
  },
  {
    id: 'agent-memory-systems',
    title: 'Agent Memory Systems',
    subtitle: 'Why long-lived agents need structured memory, reflection, and cross-session continuity.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['memory', 'reflection', 'sessions', 'continuity', 'agents'],
    content: [
      {
        title: 'Why Memory Changes Everything',
        content:
          'Without memory, an agent is mostly a sequence of disconnected turns. With memory, it can preserve continuity, personalize, summarize prior work, and carry lessons forward. That is one of the most important differences between a chatbot and a durable agent system.',
        bulletPoints: [
          'Memory enables continuity',
          'Memory enables personalization',
          'Memory enables long-horizon tasking',
        ],
      },
      {
        title: 'The Main Memory Types',
        content:
          'The most useful distinction is between episodic memory, semantic memory, reflective memory, and working memory. Product builders should avoid collapsing all memory into one flat retrieval store because different memory types have different purposes and different failure modes.',
        bulletPoints: [
          'Episodic memory',
          'Semantic memory',
          'Reflective memory',
          'Working memory',
        ],
      },
      {
        title: 'The Product Lesson',
        content:
          'The real goal is not just to store more. It is to store the right kinds of memory, synthesize useful higher-level summaries, and make it possible to resume or hand off work across sessions and surfaces. Reflection is as important as retrieval.',
        bulletPoints: [
          'Reflection matters',
          'Typed memory layers matter',
          'Cross-session handoff matters',
        ],
      },
    ],
  },
  {
    id: 'managed-agent-memory-patterns',
    title: 'Managed Agent Memory Patterns',
    subtitle: 'How the best agent systems separate startup memory, session state, archival retrieval, and transcript history.',
    category: 'frameworks',
    icon: '{}',
    color: '#14b8a6',
    tags: ['memory', 'managed agents', 'session memory', 'retrieval', 'compaction'],
    content: [
      {
        title: 'The Best Pattern',
        content:
          'The best current agent-memory pattern is not one giant memory blob. It is a layered system: always-visible instruction memory, session working memory, archival memory retrieved on demand, and transcript/log memory kept mainly for audit and recall.',
        bulletPoints: [
          'Instruction memory',
          'Session working memory',
          'Archival retrieval',
          'Transcript and logs',
        ],
      },
      {
        title: 'Why Compaction Matters',
        content:
          'Long-running agents degrade when they keep too much raw history in context. Better systems preserve plans, decisions, open questions, and artifact links while summarizing or dropping noisy traces. Compaction is a core capability, not an optimization.',
        bulletPoints: [
          'Keep plans and decisions',
          'Drop noisy traces',
          'Preserve artifact links',
        ],
      },
      {
        title: 'What Good Product UX Looks Like',
        content:
          'Users should be able to see what memory was loaded, mark something as worth remembering, prevent bad auto-memory, and review project memory in workspace surfaces. Memory quality improves when the system is both managed and visible.',
        bulletPoints: [
          'Show loaded memory sources',
          'Allow remember and forget actions',
          'Review memory at the workspace level',
        ],
      },
    ],
  },
  {
    id: 'agent-memory-ui-compaction',
    title: 'Agent Memory UI & Compaction',
    subtitle: 'How good agent products make memory visible, editable, and compact enough to stay useful over long runs.',
    category: 'frameworks',
    icon: '{}',
    color: '#22d3ee',
    tags: ['memory ui', 'compaction', 'chat ux', 'session state', 'workspace memory'],
    content: [
      {
        title: 'Memory Needs A UI',
        content:
          'Memory quality is not only a backend problem. Users need to see when memory influenced an answer, what was remembered, and how to correct bad memory. Without that, agent memory becomes opaque and trust drops.',
        bulletPoints: [
          'Show memory sources',
          'Expose remember and forget actions',
          'Keep trust high through visibility',
        ],
      },
      {
        title: 'Why Compaction Matters',
        content:
          'Long-running agents get worse if they keep every tool trace and every reply in active context. Better systems preserve plans, decisions, open questions, and artifact links while summarizing noisy traces. Compaction is what keeps session memory useful over time.',
        bulletPoints: [
          'Preserve plans and decisions',
          'Summarize noise',
          'Update session state during the run',
        ],
      },
      {
        title: 'Workspace Review',
        content:
          'Project memory should not live only inside chat bubbles. Workspace surfaces should let teams review instructions, decisions, findings, and candidate memories so durable knowledge stays curated instead of accidental.',
        bulletPoints: [
          'Review memory in project spaces',
          'Promote or retire memories deliberately',
          'Keep long-term knowledge clean',
        ],
      },
    ],
  },
  {
    id: 'semantic-memory-retrieval-privacy',
    title: 'Semantic Memory Retrieval & Privacy',
    subtitle: 'Why good agent memory depends on meaning-based retrieval, strong metadata filters, and private-by-default boundaries.',
    category: 'frameworks',
    icon: '{}',
    color: '#84cc16',
    tags: ['semantic retrieval', 'memory privacy', 'pgvector', 'rls', 'ranking'],
    content: [
      {
        title: 'Retrieval Needs Ranking',
        content:
          'Good agent memory retrieval should not rely only on recency or only on keywords. The strongest pattern is to filter by scope and visibility first, then retrieve semantically, then rerank by importance, confidence, freshness, and scope priority.',
        bulletPoints: [
          'Filter first',
          'Retrieve by meaning',
          'Rerank with metadata',
        ],
      },
      {
        title: 'Privacy Comes First',
        content:
          'Private user memory should not leak through broad shared policies. Strong agent systems enforce privacy both in database row-level security and in application query filters. One without the other is not enough.',
        bulletPoints: [
          'Use RLS correctly',
          'Use explicit app-side filters',
          'Default private memory to owner-only',
        ],
      },
      {
        title: 'The Product Lesson',
        content:
          'A managed-agent product should know not only what to remember, but what to retrieve for this user, in this workspace, for this task, without overloading context or crossing privacy boundaries.',
        bulletPoints: [
          'Task-aware retrieval',
          'Workspace-aware retrieval',
          'Private-by-default memory',
        ],
      },
    ],
  },
  {
    id: 'agent-memory-review-notes',
    title: 'Agent Memory Review Notes',
    subtitle: 'Practical lessons from reviewing a real agent-memory implementation: metadata consistency, private queries, and checkpoint snapshots.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['memory review', 'implementation notes', 'session snapshots', 'private memory'],
    content: [
      {
        title: 'Save Metadata On Insert',
        content:
          'Memory quality drops quickly if importance and retrieval metadata are applied in a fragile second update step. A stronger implementation writes ranking metadata directly when the memory is created.',
        bulletPoints: [
          'Write ranking metadata at insert time',
          'Avoid title-based follow-up updates',
          'Keep retrieval behavior consistent',
        ],
      },
      {
        title: 'Keep User Queries User-Bound',
        content:
          'A private memory system only works if the active user binding survives through review and retrieval paths. Query helpers should not silently drop the user id and fall back to broad shared reads.',
        bulletPoints: [
          'Pass user binding through every query path',
          'Separate shared and private review views',
          'Do not rely on UI filtering alone',
        ],
      },
      {
        title: 'Checkpoint, Don’t Accumulate',
        content:
          'Session summaries should behave like compact snapshots, not an ever-growing list of near-duplicate memory rows. Better systems checkpoint session state and only promote the durable parts into long-term memory.',
        bulletPoints: [
          'Use snapshot checkpoints',
          'Promote only durable information',
          'Keep long-term memory cleaner',
        ],
      },
    ],
  },
  {
    id: 'open-model-deployment-economics',
    title: 'Open Model Deployment Economics',
    subtitle: 'Why open-model cost comparisons depend on serving, utilization, and operations rather than model price alone.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['economics', 'deployment', 'vllm', 'self-hosting', 'cost'],
    content: [
      {
        title: 'The Real Economic Tradeoff',
        content:
          'Open models are attractive, but the economics are not automatically better. The real comparison is between hosted simplicity and self-hosted control. The answer depends on hardware, serving efficiency, utilization, latency needs, privacy requirements, and operational burden.',
        bulletPoints: [
          'Hosted APIs optimize for simplicity',
          'Self-hosting optimizes for control',
          'The economics depend on more than token price',
        ],
      },
      {
        title: 'Why Serving Matters',
        content:
          'The serving layer changes the economics by affecting throughput, batching, quantization, and API compatibility. This is why systems like vLLM are strategically important. They influence whether self-hosting is practical, not just whether it is theoretically possible.',
        bulletPoints: [
          'Serving affects cost per successful task',
          'OpenAI-compatible serving reduces application friction',
          'Operational efficiency matters as much as model choice',
        ],
      },
      {
        title: 'The Better Metric',
        content:
          'For most products, the better economic metric is cost per successful outcome, not cost per token alone. This keeps the analysis tied to real user value instead of abstract pricing comparisons.',
        bulletPoints: [
          'Cost per successful outcome',
          'Not just token price',
          'Not just benchmark quality',
        ],
      },
    ],
  },
  {
    id: 'ai-regulation-policy-tracker',
    title: 'AI Regulation & Policy Tracker',
    subtitle: 'The main policy and governance frameworks shaping how AI products will be built and audited.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    tags: ['policy', 'regulation', 'eu ai act', 'nist', 'oecd'],
    content: [
      {
        title: 'Why Policy Matters',
        content:
          'AI regulation and governance increasingly affect product design through transparency, logging, approvals, role boundaries, and risk classification. Even before hard legal requirements fully apply, policy ideas often become customer and enterprise expectations.',
        bulletPoints: [
          'Policy becomes product design',
          'Governance requirements shape trust',
          'Documentation and traceability are becoming more important',
        ],
      },
      {
        title: 'The Main Reference Points',
        content:
          'The EU AI Act remains the most important legal reference because it creates a comprehensive risk-based framework. NIST AI RMF remains highly important as a practical operational framework. OECD AI Principles remain a strong high-level governance reference used across many policy discussions.',
        bulletPoints: [
          'EU AI Act',
          'NIST AI RMF',
          'OECD AI Principles',
        ],
      },
      {
        title: 'Why Builders Should Care Early',
        content:
          'The strongest move is to build products with traceability, approvals, risk-aware capabilities, and auditability before those become hard external requirements. Those product choices are useful regardless of future policy shifts.',
        bulletPoints: [
          'Traceability helps now',
          'Approval systems help now',
          'Auditability helps now',
        ],
      },
    ],
  },
  {
    id: 'mcp-overview',
    title: 'MCP Overview',
    subtitle: 'What the Model Context Protocol is, why it matters, and how it fits into modern AI systems.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'protocol', 'tools', 'resources', 'context'],
    content: [
      {
        title: 'What MCP Is',
        content:
          'The Model Context Protocol is an open standard for connecting AI applications to external systems. It gives hosts a standardized way to work with external data sources, tools, and workflows. The protocol is best understood as an integration layer, not the whole product.',
        bulletPoints: [
          'Open standard',
          'Context and capability exchange layer',
          'Not a full product framework by itself',
        ],
      },
      {
        title: 'Why It Matters',
        content:
          'MCP matters because modern AI systems become more useful when they can access real context and external capabilities without requiring a custom integration for every single service. It reduces integration fragmentation and makes capability composition more realistic.',
        bulletPoints: [
          'Reduces one-off integrations',
          'Makes capabilities more composable',
          'Supports richer hosts and agents',
        ],
      },
      {
        title: 'The Key Product Lesson',
        content:
          'The host still owns user experience, permissions, and trust. MCP standardizes the interface between host and capability providers. That distinction is one of the most important things to understand if you want to use the protocol well.',
        bulletPoints: [
          'Hosts own UX',
          'Servers expose capability',
          'Protocol does not replace product design',
        ],
      },
    ],
  },
  {
    id: 'mcp-architecture-participants',
    title: 'MCP Architecture & Participants',
    subtitle: 'How hosts, clients, and servers divide responsibility in the MCP model.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'host', 'client', 'server', 'architecture'],
    content: [
      {
        title: 'The Three Main Roles',
        content:
          'MCP uses a host-client-server architecture. The host is the product the user interacts with. Each client manages one protocol connection to one server. The server exposes capability. This separation is useful because it keeps product concerns separate from protocol concerns.',
        bulletPoints: [
          'Host',
          'Client',
          'Server',
        ],
      },
      {
        title: 'Why This Separation Matters',
        content:
          'The architecture creates clear boundaries between user experience, connection handling, and capability exposure. That makes systems easier to reason about and helps keep servers focused on capability rather than trying to become full products by themselves.',
        bulletPoints: [
          'Hosts own UX and policy',
          'Clients own connections',
          'Servers own exposed capability',
        ],
      },
      {
        title: 'The Product Lesson',
        content:
          'Many teams misunderstand MCP by treating the server like the whole application. The stronger pattern is to keep the host in charge of the user experience and use the protocol as a clean capability layer.',
        bulletPoints: [
          'Do not turn servers into full apps',
          'Keep UX at the host layer',
          'Use the protocol for composition, not confusion',
        ],
      },
    ],
  },
  {
    id: 'mcp-tools-resources-prompts',
    title: 'MCP Tools, Resources, & Prompts',
    subtitle: 'The most important conceptual split in MCP and why it shapes good AI product design.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'tools', 'resources', 'prompts', 'workflow'],
    content: [
      {
        title: 'The Three Building Blocks',
        content:
          'The most important MCP server concepts are tools, resources, and prompts. These are easy to blur together, but they solve different problems. Tools are active functions. Resources are passive context sources. Prompts are reusable workflow templates.',
        bulletPoints: [
          'Tools act',
          'Resources inform',
          'Prompts guide workflows',
        ],
      },
      {
        title: 'Why The Split Matters',
        content:
          'Good AI products are clearer and safer when these concepts stay distinct. Resources are usually better for grounding and read-style access. Tools are where action and risk increase. Prompts create higher-level workflow structure without collapsing everything into raw tool calls.',
        bulletPoints: [
          'Resources help grounding',
          'Tools introduce action and risk',
          'Prompts support reusable flows',
        ],
      },
      {
        title: 'The Design Lesson',
        content:
          'This distinction is not only a protocol detail. It is a product-design advantage. Systems become easier to govern, explain, and scale when context, action, and workflow are represented separately.',
        bulletPoints: [
          'Better governance',
          'Better UX clarity',
          'Better system structure',
        ],
      },
    ],
  },
  {
    id: 'mcp-security-consent',
    title: 'MCP Security & Consent',
    subtitle: 'Why protocol power increases the importance of host-level permission and visibility design.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'security', 'consent', 'permissions', 'trust'],
    content: [
      {
        title: 'Why Security Matters Here',
        content:
          'MCP makes AI systems more useful by connecting them to real capabilities. That makes security and consent more important, not less. The product needs to make it clear what is connected, what can be called, and which actions require approval.',
        bulletPoints: [
          'Capability visibility matters',
          'Consent matters',
          'Approval design matters',
        ],
      },
      {
        title: 'Hosts Carry The Trust Model',
        content:
          'The host is responsible for permission boundaries, user authorization decisions, and the visible trust model. The protocol helps structure capability exchange, but the product still owns the actual safety experience.',
        bulletPoints: [
          'Hosts own policy',
          'Products own trust',
          'Protocol support is not enough by itself',
        ],
      },
      {
        title: 'A Useful Product Pattern',
        content:
          'A strong MCP product should make reads and writes feel different, surface connected servers clearly, and require stronger approval for risky or external tool actions. Local and remote transports should also be treated as different trust surfaces.',
        bulletPoints: [
          'Read vs write should feel different',
          'Remote vs local should feel different',
          'Approval should match risk',
        ],
      },
    ],
  },
  {
    id: 'mcp-playwright-browser-automation',
    title: 'MCP, Playwright, & Browser Automation',
    subtitle: 'How browser automation fits into MCP-style capability design.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'playwright', 'browser', 'automation', 'qa'],
    content: [
      {
        title: 'Why This Pairing Matters',
        content:
          'Playwright is one of the strongest browser automation foundations available, and MCP is one of the strongest protocol patterns for exposing external capabilities to AI hosts. Together they suggest a clean design pattern: deterministic browser power exposed through a standardized capability layer and governed by host-side UX and approvals.',
        bulletPoints: [
          'Playwright gives deterministic browser execution',
          'MCP gives structured capability exposure',
          'The host still owns policy and presentation',
        ],
      },
      {
        title: 'Why Playwright Is Strong',
        content:
          'Playwright is valuable because it supports multiple browsers, strong isolation, parallel execution, traces, and CI-friendly workflows. That makes it a very good substrate for browser-capable agent systems that need repeatability and proof.',
        bulletPoints: [
          'Cross-browser',
          'Isolation',
          'Parallelism',
          'Traces and reports',
        ],
      },
      {
        title: 'The Product Lesson',
        content:
          'The right abstraction is not that MCP replaces browser tooling. It is that browser tooling can be exposed through MCP in a safer and more composable way, while the host stays responsible for approvals, artifacts, and action visibility.',
        bulletPoints: [
          'MCP is the interface layer',
          'Playwright is the execution layer',
          'The host is the trust and UX layer',
        ],
      },
    ],
  },
  // ===========================================================================
  // AGENTS
  // ===========================================================================
  {
    id: 'claude-code',
    title: 'Claude Code',
    subtitle: 'Anthropic\'s agentic CLI that lives in your terminal and writes, edits, and ships code alongside you.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'anthropic', 'claude', 'agent'],
    relatedLessonIds: [
      'ai-tech:ai-coding:ai-coding-assistants',
      'ai-tech:ai-workflow:ai-augmented-research',
    ],
    content: [
      {
        title: 'What Is Claude Code?',
        content:
          'Claude Code is Anthropic\'s official command-line interface for agentic coding. Unlike chat-based assistants, Claude Code operates directly in your terminal with full access to your file system, shell, and development tools. It can read your entire codebase, make multi-file edits, run tests, manage git operations, and even deploy code -- all through natural language conversation. It was built by Anthropic\'s own engineering team, who use it daily to build Claude itself.',
        bulletPoints: [
          'Runs entirely in your terminal -- no browser, no IDE plugin required',
          'Reads and understands your full project context automatically',
          'Makes direct edits to files, runs shell commands, and manages git',
          'Powered by Claude Opus 4.6, Sonnet 4.6, and Haiku 4.5 models',
          'Works on macOS, Linux, and Windows via WSL',
        ],
      },
      {
        title: 'Key Features',
        content:
          'Claude Code packs an enormous feature set designed for professional software development. Hooks let you run custom scripts before or after tool calls -- for example, auto-formatting every file edit or blocking dangerous commands. MCP (Model Context Protocol) integration means Claude Code can connect to external services like GitHub, databases, Slack, and custom APIs through a standardized protocol. Skills are reusable instruction files that teach Claude Code domain-specific workflows. Subagents let Claude Code dispatch parallel workers for large tasks, dramatically speeding up multi-file refactors or code reviews.',
        bulletPoints: [
          'Hooks: PreToolUse, PostToolUse, and Stop hooks for custom automation',
          'MCP Integration: Connect to any MCP server for external tool access',
          'Skills: Markdown-based instruction files for repeatable workflows',
          'Subagents: Parallel task dispatch for large-scale operations',
          'Worktrees: Isolated git worktrees for safe feature development',
          'Plugins: Community-built extensions that add commands, agents, and skills',
        ],
      },
      {
        title: 'Models & Pricing',
        content:
          'Claude Code supports the full Claude model family. By default it uses Opus 4.6 for complex reasoning and Sonnet 4.6 for routine tasks, automatically routing between them. You can also configure it to use Haiku 4.5 for fast, inexpensive operations. Pricing is based on API token usage -- there is no separate subscription fee for Claude Code itself.',
        tableData: {
          headers: ['Model', 'Input (per 1M tokens)', 'Output (per 1M tokens)', 'Best For'],
          rows: [
            ['Opus 4.6', '$15.00', '$75.00', 'Complex architecture, debugging, planning'],
            ['Sonnet 4.6', '$3.00', '$15.00', 'Day-to-day coding, edits, refactoring'],
            ['Haiku 4.5', '$0.80', '$4.00', 'Fast tasks, commit messages, simple queries'],
          ],
        },
      },
      {
        title: 'Getting Started',
        content:
          'Installation is a single npm command. Once installed, navigate to any project directory and type "claude" to start a conversation. Claude Code will automatically detect your project type, read key files, and build context. You can give it natural language instructions like "add error handling to the API routes" or "write tests for the auth module" and it will plan, implement, and verify its changes.',
        codeExample: `# Install globally
npm install -g @anthropic-ai/claude-code

# Start in any project
cd my-project
claude

# Or run a one-shot command
claude -p "explain the architecture of this codebase"

# Use with a specific model
claude --model opus
claude --model sonnet

# Resume previous conversation
claude --continue`,
        bulletPoints: [
          'Run "claude" in any directory to start an interactive session',
          'Use "claude -p" for one-shot non-interactive commands',
          'Use "claude --continue" to resume your last conversation',
          'Configure settings in ~/.claude/settings.json',
        ],
      },
      {
        title: 'Tips & Best Practices',
        content:
          'To get the most out of Claude Code, provide clear context about what you want. Use CLAUDE.md files at the root of your project to give persistent instructions -- coding standards, architecture decisions, and project conventions. Break large tasks into focused requests rather than asking for everything at once. Use the /compact command to summarize long conversations and free up context window. Leverage hooks to enforce your team\'s standards automatically.',
        bulletPoints: [
          'Create a CLAUDE.md file with project-specific instructions and conventions',
          'Use /compact to summarize conversations and reclaim context space',
          'Prefer specific requests: "add input validation to createUser" over "improve the code"',
          'Use git worktrees for risky changes so you can easily discard them',
          'Set up hooks to auto-lint, auto-format, or block unwanted operations',
        ],
      },
    ],
  },
  {
    id: 'codex-cli',
    title: 'OpenAI Codex CLI',
    subtitle: 'OpenAI\'s open-source terminal agent for reading, editing, and executing code locally.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'openai', 'open-source'],
    content: [
      {
        title: 'Overview',
        content:
          'Codex CLI is OpenAI\'s answer to agentic coding in the terminal. Released as a fully open-source project (Apache 2.0 license), it gives developers a lightweight, fast command-line agent powered by OpenAI\'s models. It reads your local codebase, proposes changes, runs commands, and writes files -- all without leaving the terminal. Because it\'s open source, the community can extend, modify, and self-host it.',
        bulletPoints: [
          'Open source under Apache 2.0 -- fork and customize freely',
          'Lightweight Node.js-based CLI with minimal dependencies',
          'Full file system access for reading, writing, and executing',
          'Powered by OpenAI models including GPT-4.1 and o4-mini',
          'Supports sandboxed execution for safe code running',
        ],
      },
      {
        title: 'Architecture & Safety',
        content:
          'Codex CLI uses a multi-layered safety architecture. It offers three approval modes: Suggest (requires approval for everything), Auto Edit (auto-approves file edits but asks before shell commands), and Full Auto (runs everything autonomously). In Full Auto mode, commands execute inside a network-disabled sandbox to prevent unintended side effects. The tool uses a multipass approach -- first planning what to do, then executing changes, then verifying results.',
        bulletPoints: [
          'Three approval modes: Suggest, Auto Edit, Full Auto',
          'Network-disabled sandbox in Full Auto mode prevents accidental damage',
          'Multipass planning: analyze, edit, verify cycle',
          'Platform sandboxing via macOS Seatbelt and Linux namespaces',
        ],
      },
      {
        title: 'Models & Configuration',
        content:
          'By default Codex CLI uses the o4-mini model for a balance of speed and capability. You can switch to GPT-4.1 for more complex tasks or o3 for advanced reasoning. Configuration is stored in a simple config file, and you can set model preferences, approval modes, and custom instructions.',
        codeExample: `# Install
npm install -g @openai/codex

# Set your API key
export OPENAI_API_KEY="sk-..."

# Start interactive session
codex

# One-shot command
codex "refactor the auth middleware to use JWT"

# Use a specific model
codex --model gpt-4.1

# Full auto mode (sandboxed)
codex --approval-mode full-auto "add unit tests for utils/"`,
      },
      {
        title: 'Comparison with Claude Code',
        content:
          'Both Codex CLI and Claude Code are terminal-based coding agents, but they differ in important ways. Claude Code uses Anthropic\'s models and includes a richer feature set with hooks, MCP, subagents, and skills. Codex CLI is simpler and fully open source, making it easier to customize. Claude Code excels at complex multi-step tasks while Codex CLI is snappier for quick edits.',
        tableData: {
          headers: ['Feature', 'Claude Code', 'Codex CLI'],
          rows: [
            ['License', 'Proprietary (free to use)', 'Apache 2.0'],
            ['Models', 'Claude Opus/Sonnet/Haiku', 'GPT-4.1, o4-mini, o3'],
            ['MCP Support', 'Yes', 'No'],
            ['Hooks', 'Yes', 'No'],
            ['Subagents', 'Yes', 'No'],
            ['Sandbox', 'Via worktrees', 'Network-disabled sandbox'],
            ['Auto-approval', '3 levels', '3 levels'],
          ],
        },
      },
    ],
  },
  {
    id: 'gemini-cli',
    title: 'Google Gemini CLI',
    subtitle: 'Google\'s AI-powered command-line tool with a generous free tier and Gemini model access.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'google', 'gemini'],
    content: [
      {
        title: 'Overview',
        content:
          'Gemini CLI is Google\'s entry into the agentic coding space, released as an open-source tool that brings Gemini models directly into your terminal. It stands out with an extremely generous free tier -- 60 model requests per minute and 1,000 requests per day at no cost when authenticated with a personal Google account. It supports Gemini 2.5 Pro with its massive 1 million token context window, making it capable of understanding very large codebases in a single pass.',
        bulletPoints: [
          'Free tier: 60 requests/minute, 1,000 requests/day with Google account',
          'Powered by Gemini 2.5 Pro with 1M token context window',
          'Open source -- community contributions welcome',
          'Supports file editing, shell commands, and code generation',
          'MCP server integration for extended tool access',
        ],
      },
      {
        title: 'Features & Capabilities',
        content:
          'Gemini CLI offers multi-modal input including images, voice, and text. Its massive context window means it can ingest entire project directories without chunking or summarization. It supports tool use including file operations, web search, and code execution. The CLI also integrates with Google\'s broader ecosystem including Vertex AI for enterprise deployments.',
        bulletPoints: [
          'Multi-modal: paste images, screenshots, and diagrams directly',
          'Shell integration for running commands and viewing output',
          'Built-in web search using Google Search grounding',
          'Configurable system instructions via GEMINI.md files',
          'Extension system for custom tools and integrations',
        ],
      },
      {
        title: 'Getting Started',
        content:
          'Installation is straightforward via npm. Authenticate with your Google account to access the free tier, or configure a Gemini API key or Vertex AI credentials for higher rate limits.',
        codeExample: `# Install globally
npm install -g @google/gemini-cli

# Authenticate with Google account (free tier)
gemini auth login

# Start an interactive session
gemini

# One-shot command
gemini -p "explain what this project does"

# With a specific model
gemini --model gemini-2.5-pro`,
      },
      {
        title: 'Pricing Tiers',
        content:
          'Gemini CLI offers one of the most accessible pricing structures for AI coding tools thanks to its free tier. For heavier usage, you can use a paid API key or enterprise Vertex AI credentials.',
        tableData: {
          headers: ['Tier', 'Rate Limit', 'Cost', 'Best For'],
          rows: [
            ['Free (Google Account)', '60 req/min, 1K req/day', '$0', 'Individual developers'],
            ['API Key (Pay-as-you-go)', 'Higher limits', 'Per-token pricing', 'Power users'],
            ['Vertex AI', 'Enterprise limits', 'Enterprise pricing', 'Teams & organizations'],
          ],
        },
      },
    ],
  },
  {
    id: 'cursor',
    title: 'Cursor Editor',
    subtitle: 'The AI-first code editor with deep model integration, agent mode, and multi-file editing.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['ide', 'editor', 'agent'],
    content: [
      {
        title: 'What Is Cursor?',
        content:
          'Cursor is a fork of VS Code rebuilt from the ground up as an AI-first editor. Rather than bolting AI onto an existing editor as a plugin, Cursor integrates AI capabilities at every level of the editing experience. It offers inline completions (like a supercharged autocomplete), a chat sidebar for longer conversations, and Composer -- a multi-file editing agent that can plan and execute changes across your entire project.',
        bulletPoints: [
          'Fork of VS Code -- all your extensions and keybindings work',
          'Tab completion: context-aware suggestions beyond single lines',
          'Chat: sidebar conversation with full codebase context',
          'Composer: multi-file agent mode for complex refactors',
          'Supports Claude, GPT, and Gemini models',
        ],
      },
      {
        title: 'Agent Mode & Composer',
        content:
          'Composer is Cursor\'s flagship feature. In Agent mode, Composer can autonomously plan a task, search your codebase for relevant context, create new files, edit existing ones, run terminal commands, and iterate based on errors. It can handle multi-step tasks like "add authentication to this Next.js app" by creating auth routes, middleware, UI components, and database migrations -- all in a single conversation.',
        bulletPoints: [
          'Autonomous multi-file editing with intelligent planning',
          'Runs terminal commands and uses output to fix issues',
          'Searches codebase for relevant context automatically',
          'Iterates on errors -- if a build fails, it reads the error and fixes it',
          'Supports checkpoints to revert unwanted changes',
        ],
      },
      {
        title: 'Pricing & Plans',
        content:
          'Cursor offers a free tier with limited premium model usage, a Pro plan for individual developers, and a Business plan for teams. The Pro plan is the most popular, offering generous usage of premium models.',
        tableData: {
          headers: ['Plan', 'Price', 'Premium Requests', 'Features'],
          rows: [
            ['Hobby', 'Free', '50/month', 'Basic completions, limited chat'],
            ['Pro', '$20/month', '500/month', 'Full agent mode, all models, unlimited completions'],
            ['Business', '$40/user/month', '500/month', 'Team features, admin controls, SSO'],
          ],
        },
      },
      {
        title: 'Tips for Power Users',
        content:
          'To get the best results from Cursor, learn to use its context system effectively. You can tag specific files or folders with @ mentions in chat, use @codebase to search semantically across your project, and reference documentation with @docs. Setting up a .cursorrules file at the project root gives Cursor persistent context about your coding standards.',
        bulletPoints: [
          'Use @file to include specific files in chat context',
          'Use @codebase for semantic search across your entire project',
          'Create a .cursorrules file for project-specific AI instructions',
          'Use Cmd+K for inline edits without opening chat',
          'Enable "Always search" in Agent mode for better context gathering',
        ],
      },
    ],
  },
  {
    id: 'opencode',
    title: 'OpenCode',
    subtitle: 'SST\'s blazing-fast, open-source terminal agent written in Go with support for 75+ providers.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'open-source', 'sst'],
    content: [
      {
        title: 'Overview',
        content:
          'OpenCode is an open-source AI coding agent built by SST (the team behind the SST framework and Ion). Written entirely in Go, it is extremely fast to install and run -- a single binary with zero runtime dependencies. It supports over 75 AI providers out of the box, including Anthropic, OpenAI, Google, AWS Bedrock, Azure, Groq, Ollama, and many more. Licensed under MIT, it is one of the most flexible and hackable coding agents available.',
        bulletPoints: [
          'Written in Go -- single binary, no Node.js or Python required',
          'MIT licensed -- truly open source with no restrictions',
          'Supports 75+ model providers via OpenRouter, direct APIs, and local models',
          'Beautiful terminal UI with Bubble Tea framework',
          'Built-in LSP integration for code intelligence',
        ],
      },
      {
        title: 'Key Features',
        content:
          'OpenCode brings a polished TUI (Terminal User Interface) experience with file tree browsing, diff previews, and conversation management. It includes built-in tools for file editing, shell execution, and code search. The LSP integration means it can understand your code at a semantic level -- finding references, going to definitions, and understanding type information.',
        bulletPoints: [
          'Rich TUI with conversation history, file browser, and diff views',
          'LSP integration for semantic code understanding',
          'Custom tool support via MCP servers',
          'Conversation branching and session management',
          'Configurable keybindings and themes',
        ],
      },
      {
        title: 'Installation & Usage',
        content:
          'OpenCode can be installed via a single curl command or through package managers. Configuration is done via a simple opencode.json file in your project root.',
        codeExample: `# Install via curl
curl -fsSL https://opencode.ai/install | bash

# Or via go install
go install github.com/sst/opencode@latest

# Start in any project
cd my-project
opencode

# Configuration (opencode.json)
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}`,
      },
      {
        title: 'Provider Support',
        content:
          'One of OpenCode\'s biggest strengths is its provider flexibility. You can switch between cloud APIs and local models seamlessly, or even configure multiple providers and switch between them mid-conversation.',
        tableData: {
          headers: ['Provider Type', 'Examples', 'Setup'],
          rows: [
            ['Direct APIs', 'Anthropic, OpenAI, Google', 'API key in env var'],
            ['Cloud Platforms', 'AWS Bedrock, Azure OpenAI, GCP Vertex', 'Cloud credentials'],
            ['Aggregators', 'OpenRouter, Together AI, Fireworks', 'Single API key'],
            ['Local Models', 'Ollama, llama.cpp, LM Studio', 'Local server URL'],
          ],
        },
      },
    ],
  },
  {
    id: 'windsurf',
    title: 'Windsurf',
    subtitle: 'Codeium\'s AI editor with deep context awareness and the Cascade agent system.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['ide', 'editor'],
    content: [
      {
        title: 'Overview',
        content:
          'Windsurf (formerly Codeium Editor) is an AI-native code editor built by Codeium. Like Cursor, it\'s a VS Code fork with deep AI integration, but Windsurf differentiates itself with Cascade -- an agentic system that maintains awareness of your actions even when you\'re not directly chatting with it. Cascade observes your edits, terminal output, and file navigation to proactively offer relevant suggestions and catch issues.',
        bulletPoints: [
          'VS Code-based editor with full extension compatibility',
          'Cascade: always-on agentic awareness of your coding activity',
          'Flows: combines chat, inline edits, and commands into one experience',
          'Supercomplete: multi-line predictive completions',
          'Free tier available for individual developers',
        ],
      },
      {
        title: 'Cascade System',
        content:
          'Cascade is Windsurf\'s core differentiator. It operates as an always-present pair programmer that understands the full context of what you\'re working on. When you make edits manually, Cascade observes them and updates its understanding. If you encounter an error in the terminal, Cascade notices and offers to help fix it. This proactive awareness means you don\'t have to re-explain context every time you need help.',
        bulletPoints: [
          'Observes your manual edits and terminal activity in real-time',
          'Proactively suggests fixes when errors appear in the terminal',
          'Maintains a memory of your recent actions and project changes',
          'Can execute multi-step tasks autonomously',
          'Supports Claude, GPT, and Codeium\'s own models',
        ],
      },
      {
        title: 'Pricing',
        content:
          'Windsurf offers competitive pricing with a free tier, making it accessible for individuals and small teams.',
        tableData: {
          headers: ['Plan', 'Price', 'Features'],
          rows: [
            ['Free', '$0', 'Basic completions, limited Cascade, community models'],
            ['Pro', '$15/month', 'Unlimited Cascade, premium models, priority support'],
            ['Teams', '$30/user/month', 'Admin controls, usage analytics, SSO'],
          ],
        },
      },
      {
        title: 'Windsurf vs Cursor',
        content:
          'Both are VS Code forks with deep AI, but they take different approaches. Cursor focuses on explicit interaction through Composer, while Windsurf leans into implicit awareness with Cascade. Cursor has broader model support and a larger user community, while Windsurf offers a more seamless "always watching" experience.',
        bulletPoints: [
          'Cursor: explicit AI interaction through Composer and chat',
          'Windsurf: implicit AI awareness that observes your activity',
          'Cursor: larger community and more third-party resources',
          'Windsurf: lower price point and more generous free tier',
          'Both support multi-file editing and terminal integration',
        ],
      },
    ],
  },
  {
    id: 'aider',
    title: 'Aider',
    subtitle: 'The git-aware AI pair programmer that works with any LLM from your terminal.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'open-source', 'git'],
    content: [
      {
        title: 'Overview',
        content:
          'Aider is one of the original AI coding agents and remains among the most capable. It\'s a Python-based CLI tool that treats git as a first-class citizen -- every AI-generated change is automatically committed with a descriptive message, making it trivially easy to review or revert changes. Aider supports virtually every LLM provider and consistently ranks at the top of coding benchmarks.',
        bulletPoints: [
          'Git-first: every edit becomes a well-described git commit',
          'Works with Claude, GPT, Gemini, DeepSeek, Llama, and dozens more',
          'Multi-file editing with sophisticated diff-based approach',
          'Voice input support -- dictate coding instructions',
          'Architect mode: one model plans, another implements',
        ],
      },
      {
        title: 'Architect Mode',
        content:
          'Aider\'s architect mode is a powerful two-model approach. A "thinking" model (like Claude Opus or o3) analyzes your request, plans the approach, and identifies which files need changes. Then an "editing" model (like Sonnet or GPT-4.1) executes the actual code changes. This division of labor produces better results than using a single model for both planning and editing.',
        bulletPoints: [
          'Thinking model handles planning and architectural decisions',
          'Editing model executes the actual code changes efficiently',
          'Reduces costs by using expensive models only for planning',
          'Produces better results on complex multi-file refactors',
          'Configurable: choose any combination of models',
        ],
      },
      {
        title: 'Getting Started',
        content:
          'Aider is installed via pip and works in any git repository. You can specify which files to work on, and Aider will automatically include relevant context.',
        codeExample: `# Install
pip install aider-chat

# Start with Claude
export ANTHROPIC_API_KEY="sk-..."
aider

# Start with specific files
aider src/auth.ts src/middleware.ts

# Architect mode (Opus plans, Sonnet edits)
aider --architect --model opus --editor-model sonnet

# Voice input
aider --voice

# Use with local models via Ollama
aider --model ollama/deepseek-coder-v2`,
      },
      {
        title: 'Benchmark Performance',
        content:
          'Aider maintains a public leaderboard of model performance on its coding benchmark. This benchmark tests each model\'s ability to make correct code edits across a variety of real-world tasks. Aider consistently achieves top results, validating its diff-based editing approach.',
        tableData: {
          headers: ['Model', 'Aider Benchmark Score', 'Edit Format'],
          rows: [
            ['Claude Opus 4.6', '85.2%', 'diff'],
            ['Claude Sonnet 4.6', '79.8%', 'diff'],
            ['GPT-4.1', '72.1%', 'diff'],
            ['DeepSeek V3', '68.4%', 'whole file'],
            ['Gemini 2.5 Pro', '74.5%', 'diff'],
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // MODELS
  // ===========================================================================
  {
    id: 'claude-models',
    title: 'Claude Model Family',
    subtitle: 'Anthropic\'s Claude models: Opus 4.6 for deep reasoning, Sonnet 4.6 for daily work, Haiku 4.5 for speed.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['anthropic', 'claude'],
    content: [
      {
        title: 'The Claude Lineup',
        content:
          'Anthropic\'s Claude model family consists of three tiers designed for different use cases. Opus 4.6 is the flagship model -- the most intelligent, capable of sustained reasoning over extremely complex tasks. Sonnet 4.6 hits the sweet spot of intelligence and speed, making it ideal for everyday coding, writing, and analysis. Haiku 4.5 is the speed champion, delivering fast responses at low cost for simpler tasks.',
        bulletPoints: [
          'Opus 4.6: Most capable model for complex reasoning and coding',
          'Sonnet 4.6: Balanced performance for everyday tasks',
          'Haiku 4.5: Fast and affordable for simple queries and high-volume tasks',
          'All models share the same safety training and instruction-following capabilities',
          'Extended thinking mode available on Opus and Sonnet for step-by-step reasoning',
        ],
      },
      {
        title: 'Context Windows & Capabilities',
        content:
          'All Claude models support large context windows, enabling them to process entire codebases, lengthy documents, and complex conversations. The models are multimodal, accepting both text and images as input. Extended thinking mode allows the models to "think out loud" before responding, significantly improving performance on math, coding, and logical reasoning tasks.',
        tableData: {
          headers: ['Model', 'Context Window', 'Max Output', 'Extended Thinking'],
          rows: [
            ['Opus 4.6 (1M)', '1,000,000 tokens', '32,000 tokens', 'Yes'],
            ['Opus 4.6', '200,000 tokens', '32,000 tokens', 'Yes'],
            ['Sonnet 4.6', '200,000 tokens', '16,000 tokens', 'Yes'],
            ['Haiku 4.5', '200,000 tokens', '8,192 tokens', 'No'],
          ],
        },
      },
      {
        title: 'Pricing',
        content:
          'Claude\'s pricing scales with capability. Opus is the most expensive but provides the highest quality. Sonnet offers excellent value for most tasks. Haiku is extremely affordable for high-volume applications. Prompt caching can reduce input costs by up to 90% for repeated context.',
        tableData: {
          headers: ['Model', 'Input / 1M tokens', 'Output / 1M tokens', 'Cache Read / 1M tokens'],
          rows: [
            ['Opus 4.6', '$15.00', '$75.00', '$1.50'],
            ['Sonnet 4.6', '$3.00', '$15.00', '$0.30'],
            ['Haiku 4.5', '$0.80', '$4.00', '$0.08'],
          ],
        },
      },
      {
        title: 'When to Use Each Model',
        content:
          'Choosing the right model depends on your task complexity, latency requirements, and budget. Opus excels at tasks requiring deep reasoning, long-horizon planning, and complex code generation. Sonnet is the workhorse for most professional development tasks. Haiku is perfect for classification, extraction, chatbots, and other high-volume applications.',
        bulletPoints: [
          'Use Opus for: architecture design, complex debugging, research, multi-step analysis',
          'Use Sonnet for: code editing, writing, summarization, daily development tasks',
          'Use Haiku for: chatbots, data extraction, classification, commit messages',
          'Use extended thinking for: math problems, algorithmic challenges, logic puzzles',
          'Use prompt caching when: you send the same system prompt or context repeatedly',
        ],
      },
      {
        title: 'Safety & Alignment',
        content:
          'Claude models are trained with Constitutional AI (CAI), Anthropic\'s alignment approach. The models are designed to be helpful, harmless, and honest. They can refuse harmful requests while remaining maximally helpful for legitimate tasks. Anthropic publishes detailed model cards and safety evaluations for each release.',
        bulletPoints: [
          'Constitutional AI: trained to follow principles rather than just rules',
          'Refuses clearly harmful requests while minimizing false refusals',
          'Transparent about uncertainty -- says "I don\'t know" rather than hallucinating',
          'Model cards published with capability evaluations and safety benchmarks',
          'System prompts allow customization while maintaining safety boundaries',
        ],
      },
    ],
  },
  {
    id: 'gpt-models',
    title: 'GPT Model Family',
    subtitle: 'OpenAI\'s model lineup from GPT-4o to the reasoning-focused o3 and o4-mini.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['openai', 'gpt'],
    content: [
      {
        title: 'Overview',
        content:
          'OpenAI offers two main tracks of models: the GPT series for general-purpose intelligence and the "o" series for advanced reasoning. GPT-4o remains the flagship general model with strong multimodal capabilities. GPT-4.1 was trained specifically for coding and instruction-following. The o-series models (o3, o4-mini) use chain-of-thought reasoning to tackle complex math, science, and coding problems that stump traditional models.',
        bulletPoints: [
          'GPT-4o: Multimodal flagship -- text, image, audio in and out',
          'GPT-4.1: Optimized for coding, long context, and instruction following',
          'o3: Advanced reasoning model for the hardest problems',
          'o4-mini: Fast, affordable reasoning with strong coding ability',
          'All accessible via the OpenAI API and ChatGPT interface',
        ],
      },
      {
        title: 'Model Comparison',
        content:
          'Each model has distinct strengths. GPT-4o is the most versatile, handling text, images, and audio natively. GPT-4.1 excels at code generation and following complex instructions. o3 and o4-mini use internal reasoning chains that improve performance on tasks requiring multi-step logic.',
        tableData: {
          headers: ['Model', 'Context Window', 'Strengths', 'Best For'],
          rows: [
            ['GPT-4o', '128K tokens', 'Multimodal, fast', 'Chat, content, vision tasks'],
            ['GPT-4.1', '1M tokens', 'Coding, instruction following', 'Development, long docs'],
            ['o3', '200K tokens', 'Deep reasoning', 'Math, science, hard coding'],
            ['o4-mini', '200K tokens', 'Fast reasoning', 'Coding, analysis, cost-effective'],
          ],
        },
      },
      {
        title: 'Pricing',
        content:
          'OpenAI\'s pricing varies significantly across models. The reasoning models charge for both visible output tokens and internal reasoning tokens. GPT-4.1 offers strong coding performance at a competitive price point.',
        tableData: {
          headers: ['Model', 'Input / 1M tokens', 'Output / 1M tokens'],
          rows: [
            ['GPT-4o', '$2.50', '$10.00'],
            ['GPT-4.1', '$2.00', '$8.00'],
            ['o3', '$10.00', '$40.00'],
            ['o4-mini', '$1.10', '$4.40'],
          ],
        },
      },
      {
        title: 'Reasoning Models Deep Dive',
        content:
          'The o-series models represent a different approach to AI capability. Instead of generating answers directly, they "think" through problems step by step using internal reasoning tokens. This makes them dramatically better at complex logic, mathematical proofs, and multi-step coding tasks. The trade-off is higher latency and cost, since reasoning tokens are generated before the visible response.',
        bulletPoints: [
          'Internal chain-of-thought reasoning before generating response',
          'Dramatically better at math, logic, and algorithmic problems',
          'Higher latency due to reasoning phase',
          'Reasoning tokens count toward cost but are not visible to users',
          'o4-mini offers a budget-friendly way to access reasoning capabilities',
        ],
      },
    ],
  },
  {
    id: 'gemini-models',
    title: 'Gemini Model Family',
    subtitle: 'Google\'s multimodal models with industry-leading context windows and native tool use.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['google', 'gemini'],
    content: [
      {
        title: 'Overview',
        content:
          'Google\'s Gemini is a natively multimodal model family designed to process text, code, images, audio, and video in a unified architecture. The standout feature is an enormous context window -- up to 1 million tokens in production and 2 million in preview. This means Gemini can process entire codebases, hour-long videos, or thousands of pages of documents in a single prompt.',
        bulletPoints: [
          'Natively multimodal: text, code, images, audio, and video',
          'Up to 1M token context window (2M in preview)',
          'Built-in code execution sandbox',
          'Native Google Search grounding for factual accuracy',
          'Available via Google AI Studio, Vertex AI, and the Gemini app',
        ],
      },
      {
        title: 'Model Variants',
        content:
          'Gemini comes in two main sizes. Gemini 2.5 Pro is the full-power model with reasoning capabilities and massive context. Gemini 2.5 Flash is the faster, more affordable option that retains strong capabilities at lower latency and cost.',
        tableData: {
          headers: ['Model', 'Context', 'Strengths', 'Best For'],
          rows: [
            ['Gemini 2.5 Pro', '1M tokens', 'Reasoning, multimodal, code', 'Complex tasks, long docs, video'],
            ['Gemini 2.5 Flash', '1M tokens', 'Speed, efficiency', 'High-volume, real-time, cost-sensitive'],
          ],
        },
      },
      {
        title: 'Long Context Capabilities',
        content:
          'Gemini\'s long context window is its killer feature. While most models struggle with context beyond 100K tokens, Gemini maintains strong performance across its full 1M token window. This enables use cases that simply aren\'t possible with other models -- analyzing entire codebases, processing full book manuscripts, or understanding hour-long meeting recordings.',
        bulletPoints: [
          'Process entire Git repositories in a single prompt',
          'Analyze hour-long videos with frame-level understanding',
          'Compare and cross-reference thousands of pages of documentation',
          'Maintain conversation history across extremely long sessions',
          'Needle-in-a-haystack retrieval accuracy above 99% across the full context',
        ],
      },
      {
        title: 'Pricing',
        content:
          'Gemini offers competitive pricing, especially for the Flash model. The free tier through Google AI Studio makes it extremely accessible for experimentation.',
        tableData: {
          headers: ['Model', 'Input / 1M tokens', 'Output / 1M tokens', 'Free Tier'],
          rows: [
            ['2.5 Pro', '$1.25 (<=200K) / $2.50 (>200K)', '$10.00', 'Yes (rate limited)'],
            ['2.5 Flash', '$0.15 (<=200K) / $0.30 (>200K)', '$0.60 (non-thinking)', 'Yes (rate limited)'],
          ],
        },
      },
    ],
  },
  {
    id: 'llama-models',
    title: 'Llama 4 Family',
    subtitle: 'Meta\'s open-source models featuring Scout with 10M context and Maverick with 128 experts.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['meta', 'open-source', 'llama'],
    content: [
      {
        title: 'Overview',
        content:
          'Meta\'s Llama 4 represents a major leap in open-source AI. The family introduces two groundbreaking models: Scout and Maverick. Both use a Mixture of Experts (MoE) architecture where only a subset of parameters are active for any given token, making them more efficient than dense models of similar capability. Llama 4 models are released under Meta\'s permissive license, allowing commercial use.',
        bulletPoints: [
          'Scout: 109B total params, 17B active -- 10M token context window',
          'Maverick: 400B total params, 17B active -- 128 expert MoE',
          'Both use Mixture of Experts for efficient inference',
          'Open source with permissive license for commercial use',
          'Natively multilingual with support for 12 languages',
        ],
      },
      {
        title: 'Scout -- The Context Champion',
        content:
          'Llama 4 Scout is built for scenarios requiring massive context. With a 10 million token context window, it can process entire codebases, lengthy legal documents, or vast datasets in a single pass. Despite having 109B total parameters, only 17B are active per token thanks to the MoE architecture, keeping inference costs manageable.',
        bulletPoints: [
          '10M token context window -- largest of any open model',
          '109B total parameters with 16 experts, 1 active at a time',
          'Fits on a single H100 node with appropriate quantization',
          'Strong performance on long-document QA and retrieval tasks',
          'Ideal for RAG, code analysis, and document processing',
        ],
      },
      {
        title: 'Maverick -- The Powerhouse',
        content:
          'Llama 4 Maverick is the high-capability model in the family. With 400B total parameters spread across 128 experts, it delivers strong performance across coding, reasoning, and creative tasks while maintaining efficient inference through its MoE architecture.',
        bulletPoints: [
          '400B total params, 17B active per token',
          '128 expert MoE architecture for specialized processing',
          'Competitive with leading proprietary models on benchmarks',
          'Strong multilingual and multimodal capabilities',
          'Available on major cloud providers and via API',
        ],
      },
      {
        title: 'Running Llama Locally',
        content:
          'One of Llama\'s biggest advantages is the ability to run it on your own hardware. With quantization, even Scout can run on consumer GPUs. This is useful for privacy-sensitive applications, offline use, or avoiding API costs.',
        codeExample: `# Using Ollama
ollama pull llama4-scout
ollama run llama4-scout

# Using llama.cpp with GGUF
./llama-cli -m llama-4-scout-Q4_K_M.gguf \\
  -p "Explain the MoE architecture" \\
  -n 512 --ctx-size 8192

# Using Hugging Face Transformers
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-4-Scout-109B-Instruct",
    torch_dtype=torch.bfloat16,
    device_map="auto"
)`,
      },
    ],
  },
  {
    id: 'qwen-models',
    title: 'Qwen 3.5 Family',
    subtitle: 'Alibaba\'s Apache 2.0 model lineup spanning from 0.8B to 397B parameters.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['alibaba', 'open-source', 'qwen'],
    content: [
      {
        title: 'Overview',
        content:
          'Qwen 3.5 is Alibaba Cloud\'s latest model family, notable for its Apache 2.0 license (fully open, no restrictions) and extraordinary range of sizes. From the tiny 0.8B model that runs on a phone to the massive 397B MoE model rivaling proprietary offerings, Qwen 3.5 covers every use case. The models offer both dense and Mixture of Experts architectures, with strong performance in coding, math, and multilingual tasks.',
        bulletPoints: [
          'Apache 2.0 license -- fully open for commercial and research use',
          'Size range: 0.8B, 1.5B, 3B, 8B, 14B, 32B, 72B dense + 235B and 397B MoE',
          'Hybrid thinking: models can switch between fast response and deep reasoning',
          'Strong multilingual support with 119 languages',
          'Competitive with Claude Sonnet and GPT-4o on key benchmarks',
        ],
      },
      {
        title: 'Dense vs MoE Models',
        content:
          'Qwen 3.5 offers both dense models (all parameters active for every token) and MoE models (only a subset of experts active). Dense models from 0.8B to 72B are great for deployment on various hardware. The MoE models at 235B and 397B deliver frontier-level performance with efficient inference.',
        tableData: {
          headers: ['Model', 'Architecture', 'Active Params', 'Best For'],
          rows: [
            ['0.8B / 1.5B', 'Dense', 'Full', 'Mobile, edge devices, embedded'],
            ['3B / 8B', 'Dense', 'Full', 'Local inference, consumer GPUs'],
            ['14B / 32B', 'Dense', 'Full', 'Strong general purpose'],
            ['72B', 'Dense', 'Full', 'High-quality, single-node deployment'],
            ['235B MoE', 'MoE (128E/8A)', '22B', 'Cost-effective frontier performance'],
            ['397B MoE', 'MoE (160E/8A)', '30B', 'Maximum capability'],
          ],
        },
      },
      {
        title: 'Hybrid Thinking Mode',
        content:
          'Qwen 3.5 introduces hybrid thinking -- models that can dynamically switch between "fast" mode (direct response) and "thinking" mode (step-by-step reasoning with internal chain-of-thought). This means a single model can handle both quick queries efficiently and complex problems thoroughly, without needing separate model deployments.',
        bulletPoints: [
          'Enable thinking with a simple parameter flag in the API',
          'Model allocates a thinking budget proportional to problem difficulty',
          'Thinking tokens are visible and can be used for debugging',
          'Fast mode for latency-sensitive applications',
          'Deep thinking mode for math, coding, and reasoning tasks',
        ],
      },
      {
        title: 'Running Qwen Locally',
        content:
          'Qwen models are widely available through local inference frameworks. Their Apache 2.0 license means no restrictions on how you deploy them.',
        codeExample: `# Via Ollama
ollama pull qwen3.5:8b
ollama run qwen3.5:8b

# Via llama.cpp (GGUF format)
./llama-cli -m qwen3.5-8b-q4_k_m.gguf \\
  -p "Write a Python function to merge sort"

# Via vLLM for production serving
vllm serve Qwen/Qwen3.5-72B-Instruct \\
  --tensor-parallel-size 4

# Python with Transformers
from transformers import AutoModelForCausalLM, AutoTokenizer
model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3.5-72B-Instruct",
    torch_dtype="auto",
    device_map="auto"
)`,
      },
    ],
  },
  {
    id: 'deepseek-models',
    title: 'DeepSeek Models',
    subtitle: 'Open-source models excelling at reasoning, coding, and cost efficiency with novel MoE architecture.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['deepseek', 'open-source', 'reasoning'],
    content: [
      {
        title: 'Overview',
        content:
          'DeepSeek has emerged as one of the most impressive AI labs, producing open-source models that rival or exceed proprietary offerings at a fraction of the training cost. Their V3 model demonstrated that frontier-level performance doesn\'t require billion-dollar training budgets. DeepSeek R1 introduced a novel reasoning approach that sparked the "reasoning model" wave across the industry.',
        bulletPoints: [
          'DeepSeek V3: 671B MoE model, 37B active -- strong general performance',
          'DeepSeek R1: Reasoning model trained via reinforcement learning',
          'DeepSeek Coder V2: Specialized for code generation and understanding',
          'MIT license on all models -- fully open for any use',
          'Trained at remarkably low cost compared to Western labs',
        ],
      },
      {
        title: 'DeepSeek R1 -- Reasoning Breakthrough',
        content:
          'DeepSeek R1 was a watershed moment for open-source AI. Rather than using supervised fine-tuning on reasoning traces, DeepSeek trained R1 primarily through reinforcement learning, letting the model discover its own reasoning strategies. The result is a model with genuine "thinking" capabilities that rival OpenAI\'s o1 at a fraction of the cost.',
        bulletPoints: [
          'Trained via large-scale reinforcement learning, not just SFT',
          'Discovers emergent reasoning strategies during training',
          'Competitive with o1 on math, coding, and science benchmarks',
          'Distilled versions (1.5B to 70B) retain reasoning capability',
          'Open weights and detailed technical report published',
        ],
      },
      {
        title: 'Architecture -- MoE Efficiency',
        content:
          'DeepSeek pioneered several architectural innovations in their MoE design. Multi-head Latent Attention (MLA) compresses key-value caches to reduce memory usage during long-context inference. DeepSeekMoE uses fine-grained expert segmentation and shared experts for better load balancing.',
        tableData: {
          headers: ['Model', 'Total Params', 'Active Params', 'Architecture', 'License'],
          rows: [
            ['DeepSeek V3', '671B', '37B', 'MoE (256E/8A)', 'MIT'],
            ['DeepSeek R1', '671B', '37B', 'MoE (256E/8A)', 'MIT'],
            ['R1-Distill-Qwen-32B', '32B', '32B', 'Dense (distilled)', 'MIT'],
            ['R1-Distill-Llama-70B', '70B', '70B', 'Dense (distilled)', 'MIT'],
            ['DeepSeek Coder V2', '236B', '21B', 'MoE', 'MIT'],
          ],
        },
      },
      {
        title: 'Using DeepSeek Models',
        content:
          'DeepSeek models are available through the DeepSeek API (extremely affordable), major cloud providers, and local inference frameworks. The distilled R1 versions are particularly popular for local deployment due to their strong reasoning in smaller packages.',
        codeExample: `# DeepSeek API (very affordable)
from openai import OpenAI  # Compatible with OpenAI SDK

client = OpenAI(
    api_key="your-deepseek-key",
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model="deepseek-reasoner",  # R1
    messages=[{"role": "user", "content": "Prove that sqrt(2) is irrational"}]
)

# Local with Ollama
# ollama pull deepseek-r1:32b
# ollama run deepseek-r1:32b`,
      },
    ],
  },

  // ===========================================================================
  // FRAMEWORKS
  // ===========================================================================
  {
    id: 'anthropic-sdk',
    title: 'Anthropic Agent SDK',
    subtitle: 'Build custom AI agents with tool use, MCP integration, and multi-agent orchestration.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['sdk', 'anthropic'],
    content: [
      {
        title: 'Overview',
        content:
          'The Anthropic Agent SDK provides Python and TypeScript libraries for building custom AI agents powered by Claude. Going beyond simple chat completions, the SDK supports tool use (function calling), MCP server integration, multi-turn conversations with memory, and multi-agent orchestration. It is designed to be minimal and composable, avoiding the heavy abstractions of larger frameworks.',
        bulletPoints: [
          'Available in Python (claude-agent-sdk) and TypeScript (@anthropic-ai/claude-agent-sdk)',
          'Built-in tool use with automatic schema generation from function signatures',
          'Native MCP client for connecting to any MCP server',
          'Multi-agent orchestration with handoffs and delegation',
          'Streaming support for real-time token-by-token output',
        ],
      },
      {
        title: 'Basic Agent Example',
        content:
          'Creating an agent is straightforward. Define your tools as regular functions with type hints, then create an Agent with a model, instructions, and tools. The SDK handles the conversation loop, tool execution, and response formatting automatically.',
        codeExample: `import anthropic
from claude_agent_sdk import Agent, tool

client = anthropic.Anthropic()

@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    # In production, call a real weather API
    return f"72F and sunny in {city}"

@tool
def search_restaurants(city: str, cuisine: str) -> list[str]:
    """Search for restaurants in a city by cuisine type."""
    return [f"Best {cuisine} in {city}: Restaurant A, Restaurant B"]

agent = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You are a helpful travel assistant.",
    tools=[get_weather, search_restaurants],
)

# Run the agent
result = agent.run("What's the weather in Tokyo and find me some ramen spots?")
print(result.final_response)`,
      },
      {
        title: 'MCP Integration',
        content:
          'The SDK includes a built-in MCP client that lets your agent connect to any MCP server. This means your agent can access databases, APIs, file systems, and other services through the standardized MCP protocol without writing custom integration code.',
        codeExample: `from claude_agent_sdk import Agent, MCPServerStdio

# Connect to MCP servers
github_server = MCPServerStdio(
    command="npx",
    args=["-y", "@modelcontextprotocol/server-github"],
    env={"GITHUB_TOKEN": "ghp_..."}
)

postgres_server = MCPServerStdio(
    command="npx",
    args=["-y", "@modelcontextprotocol/server-postgres",
          "postgresql://localhost/mydb"]
)

agent = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You help manage our GitHub repos and database.",
    mcp_servers=[github_server, postgres_server],
)

result = agent.run("List open PRs and check if the users table has a new column")`,
      },
      {
        title: 'Multi-Agent Orchestration',
        content:
          'For complex workflows, you can create multiple specialized agents that hand off to each other. Each agent has its own instructions, tools, and capabilities. The orchestrating agent decides when to delegate to a specialist.',
        codeExample: `from claude_agent_sdk import Agent, tool

code_reviewer = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You are an expert code reviewer. Analyze code for bugs and style.",
    tools=[read_file, search_codebase],
)

test_writer = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You write comprehensive unit tests.",
    tools=[read_file, write_file, run_tests],
)

orchestrator = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You coordinate code review and test writing.",
    handoffs=[code_reviewer, test_writer],
)

result = orchestrator.run("Review src/auth.ts and write tests for it")`,
        bulletPoints: [
          'Each agent can have its own model, instructions, and tools',
          'Handoffs transfer conversation context between agents',
          'Orchestrator agent decides when to delegate to specialists',
          'Supports hierarchical and peer-to-peer agent topologies',
        ],
      },
    ],
  },
  {
    id: 'openai-agents-sdk',
    title: 'OpenAI Agents SDK',
    subtitle: 'Build multi-agent systems with handoffs, guardrails, and built-in tracing.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['sdk', 'openai'],
    content: [
      {
        title: 'Overview',
        content:
          'The OpenAI Agents SDK is a lightweight Python framework for building agentic applications. It provides three core primitives: Agents (LLMs with instructions and tools), Handoffs (delegation between agents), and Guardrails (input/output validation). The SDK includes built-in tracing for debugging and monitoring agent behavior, making it production-ready out of the box.',
        bulletPoints: [
          'Three primitives: Agents, Handoffs, and Guardrails',
          'Built-in tracing and observability for debugging',
          'Guardrails for input validation and output safety',
          'Streaming support for real-time responses',
          'Compatible with any OpenAI-compatible API endpoint',
        ],
      },
      {
        title: 'Agent & Tool Definition',
        content:
          'Agents are defined declaratively with a model, instructions, and list of tools. Tools are plain Python functions decorated with @function_tool. The SDK automatically generates the JSON schema from type hints.',
        codeExample: `from agents import Agent, Runner, function_tool

@function_tool
def lookup_order(order_id: str) -> str:
    """Look up an order by its ID and return its status."""
    return f"Order {order_id}: Shipped, arriving tomorrow"

@function_tool
def cancel_order(order_id: str) -> str:
    """Cancel an order by its ID."""
    return f"Order {order_id} has been cancelled"

support_agent = Agent(
    name="Customer Support",
    instructions="You help customers with order inquiries.",
    model="gpt-4.1",
    tools=[lookup_order, cancel_order],
)

# Run the agent
result = Runner.run_sync(
    support_agent,
    "Where is my order ORD-12345?"
)
print(result.final_output)`,
      },
      {
        title: 'Handoffs Between Agents',
        content:
          'Handoffs let you create specialized agents that transfer control to each other. This is powerful for building support systems, multi-step workflows, or any scenario where different expertise is needed at different stages.',
        codeExample: `from agents import Agent, Runner

billing_agent = Agent(
    name="Billing Specialist",
    instructions="You handle billing and payment questions.",
    tools=[get_invoice, process_refund],
)

technical_agent = Agent(
    name="Technical Support",
    instructions="You handle technical issues and bug reports.",
    tools=[search_docs, create_ticket],
)

triage_agent = Agent(
    name="Triage",
    instructions="Route customers to the right specialist.",
    handoffs=[billing_agent, technical_agent],
)

result = Runner.run_sync(triage_agent, "I was charged twice for my subscription")
# Triage agent hands off to billing_agent automatically`,
      },
      {
        title: 'Guardrails & Tracing',
        content:
          'Guardrails are validation layers that check inputs and outputs. Input guardrails run before the agent processes a message, while output guardrails validate the response. The built-in tracing system records every step of agent execution for debugging and monitoring.',
        bulletPoints: [
          'Input guardrails: validate user messages before processing',
          'Output guardrails: check agent responses before returning',
          'Can use a separate LLM call for sophisticated validation',
          'Built-in tracing records tool calls, handoffs, and responses',
          'Traces exportable to OpenTelemetry-compatible backends',
        ],
      },
    ],
  },
  {
    id: 'langchain',
    title: 'LangChain & LangGraph',
    subtitle: 'The most popular framework for building LLM applications with chains, agents, and graphs.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['framework', 'open-source'],
    content: [
      {
        title: 'Overview',
        content:
          'LangChain is the most widely adopted framework for building applications with large language models. It started as a library for "chaining" LLM calls together and has evolved into a comprehensive ecosystem. LangGraph, its companion library, adds stateful graph-based orchestration for building complex agents. Together they form a complete toolkit for everything from simple chatbots to sophisticated multi-agent systems.',
        bulletPoints: [
          'LangChain: Core library with model abstraction, prompts, and tools',
          'LangGraph: Stateful graph-based agent orchestration',
          'LangSmith: Observability, testing, and evaluation platform',
          'Supports every major LLM provider',
          'Huge ecosystem of integrations (700+ packages)',
        ],
      },
      {
        title: 'LangChain Basics',
        content:
          'LangChain provides a unified interface for interacting with different LLM providers, constructing prompts, and chaining operations together. The core abstraction is the "Runnable" -- a composable unit that takes input and produces output.',
        codeExample: `from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# Create a simple chain
model = ChatAnthropic(model="claude-sonnet-4-20250514")
prompt = ChatPromptTemplate.from_template(
    "Explain {topic} in 3 bullet points"
)

chain = prompt | model | StrOutputParser()
result = chain.invoke({"topic": "quantum computing"})

# With tool use
from langchain_core.tools import tool

@tool
def calculate(expression: str) -> float:
    """Evaluate a math expression."""
    return eval(expression)

model_with_tools = model.bind_tools([calculate])`,
      },
      {
        title: 'LangGraph for Agents',
        content:
          'LangGraph enables building agents as state machines represented by graphs. Nodes are functions that process state, and edges define the flow between them. This gives you precise control over agent behavior, including loops, branching, and human-in-the-loop checkpoints.',
        codeExample: `from langgraph.graph import StateGraph, START, END
from typing import TypedDict

class AgentState(TypedDict):
    messages: list
    next_action: str

def call_model(state: AgentState):
    response = model.invoke(state["messages"])
    return {"messages": state["messages"] + [response]}

def should_continue(state: AgentState):
    last = state["messages"][-1]
    if last.tool_calls:
        return "tools"
    return END

# Build the graph
graph = StateGraph(AgentState)
graph.add_node("agent", call_model)
graph.add_node("tools", tool_executor)
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue)
graph.add_edge("tools", "agent")

app = graph.compile()`,
        bulletPoints: [
          'Nodes: functions that read and update shared state',
          'Edges: define flow (conditional or unconditional)',
          'Checkpointing: save and resume agent state',
          'Human-in-the-loop: pause for user approval at any step',
          'Streaming: token-by-token output from any node',
        ],
      },
      {
        title: 'When to Use LangChain',
        content:
          'LangChain is ideal when you need provider flexibility, complex orchestration, or access to a large integration ecosystem. For simpler projects, the native SDKs (Anthropic SDK, OpenAI SDK) may be more appropriate since they have less abstraction overhead.',
        bulletPoints: [
          'Use LangChain when: you need multi-provider support or complex chains',
          'Use LangGraph when: you need stateful agents with precise control flow',
          'Use native SDKs when: you are committed to one provider and want minimal overhead',
          'LangSmith is valuable for: debugging, testing, and monitoring in production',
          'Consider the trade-off: more abstraction = more flexibility but more complexity',
        ],
      },
    ],
  },
  {
    id: 'crewai',
    title: 'CrewAI',
    subtitle: 'Multi-agent orchestration framework with role-based agents, crews, and automated workflows.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['framework', 'multi-agent'],
    content: [
      {
        title: 'Overview',
        content:
          'CrewAI is a framework for orchestrating multiple AI agents working together as a team. Each agent has a specific role, goal, and backstory that guides its behavior. Agents are organized into "crews" that collaborate on complex tasks through defined processes. CrewAI also offers "flows" for building structured multi-step workflows that combine agent intelligence with deterministic logic.',
        bulletPoints: [
          'Role-based agents with defined personas and expertise',
          'Crews: teams of agents that collaborate on shared tasks',
          'Flows: structured workflows combining AI and traditional logic',
          'Sequential and hierarchical process types',
          'Built-in memory for agents to learn across interactions',
        ],
      },
      {
        title: 'Defining Agents & Tasks',
        content:
          'In CrewAI, agents are defined with a role, goal, and backstory. Tasks describe what needs to be done and are assigned to specific agents. The crew manages the overall process and coordination.',
        codeExample: `from crewai import Agent, Task, Crew, Process

researcher = Agent(
    role="Senior Research Analyst",
    goal="Find comprehensive data on market trends",
    backstory="You are a veteran analyst with 20 years in tech research.",
    tools=[search_tool, web_scraper],
    llm="claude-sonnet-4-20250514",
)

writer = Agent(
    role="Technical Writer",
    goal="Create clear, engaging reports from research data",
    backstory="You are an award-winning technical writer.",
    llm="claude-sonnet-4-20250514",
)

research_task = Task(
    description="Research the current state of AI coding agents in 2026",
    expected_output="A detailed summary with key findings",
    agent=researcher,
)

writing_task = Task(
    description="Write a blog post based on the research findings",
    expected_output="A polished 1000-word blog post",
    agent=writer,
)

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,
)

result = crew.kickoff()`,
      },
      {
        title: 'Flows for Structured Workflows',
        content:
          'Flows are CrewAI\'s way of building reliable, reproducible workflows. They let you combine agent-driven steps with traditional code logic -- for example, fetching data from an API, having an agent analyze it, then storing results in a database.',
        bulletPoints: [
          'Combine AI agent steps with deterministic code steps',
          'Conditional branching based on agent output or data',
          'Built-in state management across flow steps',
          'Error handling and retry logic',
          'Can trigger crews as part of a larger flow',
        ],
      },
      {
        title: 'Process Types',
        content:
          'CrewAI supports different process types that define how agents collaborate within a crew.',
        tableData: {
          headers: ['Process', 'How It Works', 'Best For'],
          rows: [
            ['Sequential', 'Tasks execute one after another, each building on the last', 'Linear workflows with dependencies'],
            ['Hierarchical', 'A manager agent delegates and coordinates other agents', 'Complex projects needing oversight'],
            ['Consensual', 'Agents discuss and agree on approach before executing', 'Decisions requiring multiple perspectives'],
          ],
        },
      },
    ],
  },
  {
    id: 'vercel-ai-sdk',
    title: 'Vercel AI SDK',
    subtitle: 'The TypeScript toolkit for building AI-powered user interfaces with streaming and multi-provider support.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['sdk', 'vercel', 'react'],
    content: [
      {
        title: 'Overview',
        content:
          'The Vercel AI SDK is a TypeScript library designed specifically for building AI-powered user interfaces. It provides React hooks and server utilities for streaming AI responses, managing conversations, and rendering tool results -- all with a focus on great UX. Unlike backend-focused frameworks, the AI SDK is built for the full stack, from server-side model calls to client-side streaming UI.',
        bulletPoints: [
          'React hooks for chat, completions, and streaming',
          'Unified provider interface: switch models with one line change',
          'Streaming UI: render AI responses token-by-token',
          'Tool calling with automatic UI generation',
          'Works with Next.js, Nuxt, SvelteKit, and Express',
        ],
      },
      {
        title: 'Core Streaming Example',
        content:
          'The AI SDK makes it trivial to stream AI responses in a React app. The useChat hook handles the conversation state, message history, and streaming automatically.',
        codeExample: `// app/api/chat/route.ts (Next.js API Route)
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    messages,
    tools: {
      getWeather: {
        description: 'Get weather for a city',
        parameters: z.object({ city: z.string() }),
        execute: async ({ city }) => {
          return { temp: 72, condition: 'sunny' };
        },
      },
    },
  });

  return result.toDataStreamResponse();
}

// app/page.tsx (React Client)
'use client';
import { useChat } from '@ai-sdk/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}`,
      },
      {
        title: 'Multi-Provider Support',
        content:
          'The AI SDK provides a unified interface across providers. Switching from Claude to GPT to Gemini requires changing a single line of code. This makes it easy to test different models or let users choose their preferred provider.',
        tableData: {
          headers: ['Provider', 'Package', 'Models'],
          rows: [
            ['Anthropic', '@ai-sdk/anthropic', 'Claude Opus, Sonnet, Haiku'],
            ['OpenAI', '@ai-sdk/openai', 'GPT-4o, GPT-4.1, o3, o4-mini'],
            ['Google', '@ai-sdk/google', 'Gemini 2.5 Pro, Flash'],
            ['Mistral', '@ai-sdk/mistral', 'Large, Medium, Small'],
            ['Amazon Bedrock', '@ai-sdk/amazon-bedrock', 'All Bedrock models'],
          ],
        },
      },
      {
        title: 'Generative UI',
        content:
          'One of the AI SDK\'s most innovative features is Generative UI -- the ability to stream React components from the server as part of an AI response. Instead of just streaming text, the AI can return interactive UI elements like charts, forms, and cards.',
        bulletPoints: [
          'Stream React Server Components as part of AI responses',
          'Tool results can render as interactive UI components',
          'Mix text and UI elements in a single streaming response',
          'Great for building rich AI dashboards and assistants',
          'Works with React Server Components in Next.js',
        ],
      },
    ],
  },

  // ===========================================================================
  // DESIGN
  // ===========================================================================
  {
    id: 'dark-mode',
    title: 'Dark Mode Design',
    subtitle: 'Best practices for implementing dark mode with system detection, tokens, and accessibility.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['css', 'theme', 'accessibility'],
    content: [
      {
        title: 'Why Dark Mode Matters',
        content:
          'Dark mode has gone from a nice-to-have to an expected feature. Over 80% of users report using dark mode on at least one device. Beyond preference, dark mode reduces eye strain in low-light environments, saves battery on OLED screens, and can improve accessibility for users with certain visual conditions. A well-implemented dark mode also signals design sophistication.',
        bulletPoints: [
          'Reduces eye strain in low-light conditions',
          'Saves 30-60% battery on OLED displays',
          'Improves readability for some visual conditions (light sensitivity)',
          'Expected by users -- over 80% use dark mode on at least one device',
          'Can reduce migraines and visual fatigue for sensitive users',
        ],
      },
      {
        title: 'System Detection',
        content:
          'The first step is respecting the user\'s operating system preference. CSS prefers-color-scheme and React Native\'s Appearance API let you detect this automatically. Best practice is to offer three modes: light, dark, and system (auto).',
        codeExample: `/* CSS: Detect system preference */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #0a0a0a;
    --text-primary: #fafafa;
    --border: #262626;
  }
}

/* React Native: Detect system preference */
import { useColorScheme } from 'react-native';

function App() {
  const colorScheme = useColorScheme(); // 'light' | 'dark'
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  return <ThemeProvider theme={theme}>...</ThemeProvider>;
}`,
      },
      {
        title: 'Token-Based Theming',
        content:
          'The most maintainable approach to dark mode is token-based theming. Define semantic color tokens (like "background-primary" or "text-muted") that map to different values in light and dark modes. This way, components never reference raw colors -- they reference tokens that automatically adapt.',
        bulletPoints: [
          'Define semantic tokens: background, text, border, accent, etc.',
          'Never use raw hex colors in components -- always use tokens',
          'Each token maps to a different value per theme',
          'Add semantic levels: primary, secondary, tertiary for each category',
          'Include special tokens for interactive states: hover, focus, pressed',
        ],
        codeExample: `// Token-based theme system
const tokens = {
  light: {
    bgPrimary: '#ffffff',
    bgSecondary: '#f5f5f5',
    bgTertiary: '#e5e5e5',
    textPrimary: '#0a0a0a',
    textSecondary: '#525252',
    textMuted: '#a3a3a3',
    border: '#e5e5e5',
    accent: '#6366f1',
  },
  dark: {
    bgPrimary: '#0a0a0a',
    bgSecondary: '#171717',
    bgTertiary: '#262626',
    textPrimary: '#fafafa',
    textSecondary: '#d4d4d4',
    textMuted: '#737373',
    border: '#262626',
    accent: '#818cf8',
  },
};`,
      },
      {
        title: 'Common Pitfalls',
        content:
          'Many dark mode implementations fall into common traps that result in poor readability or jarring transitions. Avoid these mistakes for a polished result.',
        bulletPoints: [
          'Do not just invert colors -- pure white on pure black is too harsh',
          'Use slightly off-black backgrounds (#0a0a0a or #121212) and off-white text (#e5e5e5)',
          'Reduce elevation shadows -- they don\'t work on dark backgrounds; use lighter surfaces instead',
          'Test with real content -- dark mode issues often appear only with actual UI layouts',
          'Animate the transition between themes smoothly (300ms ease-in-out)',
          'Do not forget images -- add subtle dark overlays to prevent bright images from blinding users',
        ],
      },
    ],
  },
  {
    id: 'motion-design',
    title: 'Motion & Animation',
    subtitle: 'Spring physics, scroll-driven animations, Framer Motion, and GSAP for modern interfaces.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['animation', 'css', 'react'],
    content: [
      {
        title: 'Why Motion Matters',
        content:
          'Motion is not decoration -- it\'s information. Well-designed animations communicate spatial relationships (where did this element come from?), causality (what caused this change?), and hierarchy (what should I focus on?). Motion guides attention, provides feedback, and creates a sense of direct manipulation that makes interfaces feel responsive and alive.',
        bulletPoints: [
          'Communicates spatial relationships and hierarchy',
          'Provides immediate feedback for user actions',
          'Guides attention to important changes',
          'Creates a sense of quality and polish',
          'Reduces cognitive load by making transitions continuous rather than instant',
        ],
      },
      {
        title: 'Spring Physics',
        content:
          'Modern animation libraries favor spring physics over traditional easing curves. Springs produce more natural-feeling motion because they simulate real-world physics -- objects have mass, tension, and friction. Unlike cubic-bezier easing, springs are interruptible and can be redirected mid-animation without discontinuity.',
        codeExample: `// Framer Motion spring animation
import { motion } from 'framer-motion';

function Card() {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        type: 'spring',
        stiffness: 300,  // Higher = snappier
        damping: 20,     // Higher = less bounce
        mass: 1,         // Higher = more sluggish
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <h2>Interactive Card</h2>
    </motion.div>
  );
}`,
        bulletPoints: [
          'Stiffness: controls how quickly the spring reaches its target',
          'Damping: controls how quickly oscillation stops (higher = less bounce)',
          'Mass: controls the inertia (higher = slower to start and stop)',
          'Springs are interruptible -- animation can be reversed mid-flight',
          'No fixed duration -- the spring naturally settles based on physics',
        ],
      },
      {
        title: 'Scroll-Driven Animations',
        content:
          'CSS now supports scroll-driven animations natively, without JavaScript. Elements can animate based on scroll position using scroll-timeline and view-timeline. This enables performant, compositor-driven animations for scroll-based effects like parallax, progress indicators, and reveal animations.',
        codeExample: `/* CSS Scroll-Driven Animation */
@keyframes reveal {
  from { opacity: 0; transform: translateY(50px); }
  to   { opacity: 1; transform: translateY(0); }
}

.card {
  animation: reveal linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 100%;
}

/* Scroll progress indicator */
.progress-bar {
  animation: grow linear;
  animation-timeline: scroll();
  transform-origin: left;
}

@keyframes grow {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}`,
        bulletPoints: [
          'No JavaScript needed -- pure CSS with hardware acceleration',
          'scroll() timeline: animates based on scroll position of a container',
          'view() timeline: animates based on element visibility in viewport',
          'animation-range: fine control over when animation starts and ends',
          'Works with existing @keyframes -- no new syntax to learn',
        ],
      },
      {
        title: 'Animation Libraries Comparison',
        content:
          'The right animation library depends on your stack and needs. Here is how the major options compare.',
        tableData: {
          headers: ['Library', 'Best For', 'Size', 'API Style'],
          rows: [
            ['Framer Motion', 'React declarative animations', '~33KB', 'Declarative (JSX props)'],
            ['GSAP', 'Complex timelines, SVG, scroll', '~25KB', 'Imperative (timeline API)'],
            ['React Native Reanimated', 'React Native 60fps animations', '~75KB', 'Worklet-based'],
            ['CSS Animations', 'Simple transitions, scroll-driven', '0KB', 'Declarative (CSS)'],
            ['Motion One', 'Lightweight web animations', '~3KB', 'Imperative (minimal API)'],
          ],
        },
      },
    ],
  },
  {
    id: 'ai-ui-patterns',
    title: 'AI Interface Patterns',
    subtitle: 'UX patterns for streaming text, loading states, prompt inputs, and tool visualization.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['ai', 'ux', 'patterns'],
    content: [
      {
        title: 'The Challenge of AI UX',
        content:
          'AI interfaces have unique UX challenges that traditional software does not face. Responses take seconds to generate rather than milliseconds. Output quality is unpredictable -- the same prompt might give excellent or mediocre results. Users need to understand what the AI is doing (especially during tool use) without being overwhelmed by technical details. These challenges require purpose-built UI patterns.',
        bulletPoints: [
          'Latency: AI responses take 1-30 seconds, requiring thoughtful loading states',
          'Streaming: tokens arrive one by one, needing smooth rendering',
          'Uncertainty: users need confidence signals without false precision',
          'Transparency: tool use and reasoning should be visible but not overwhelming',
          'Prompt design: helping users communicate effectively with AI',
        ],
      },
      {
        title: 'Streaming Text Rendering',
        content:
          'Token-by-token streaming is the most important AI UX pattern. It reduces perceived latency dramatically -- users can start reading immediately instead of waiting for the full response. The key is smooth rendering without visual jank.',
        bulletPoints: [
          'Show a typing indicator during the initial delay before tokens arrive',
          'Render tokens smoothly -- batch DOM updates every 16ms (one frame)',
          'Animate new tokens with a subtle fade-in rather than instant appearance',
          'Auto-scroll to keep the latest content visible, but stop if user scrolls up',
          'Show a "generating..." indicator at the bottom while streaming is active',
          'Render markdown incrementally -- do not wait for the full response to format',
        ],
        codeExample: `// Smooth streaming text component (React)
function StreamingText({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  useEffect(() => {
    if (isAutoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content, isAutoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setIsAutoScroll(isAtBottom);
  };

  return (
    <div ref={containerRef} onScroll={handleScroll}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}`,
      },
      {
        title: 'Tool Use Visualization',
        content:
          'When an AI agent uses tools (searching files, running code, calling APIs), users need visibility into what is happening. The key is progressive disclosure -- show enough to build confidence without overwhelming.',
        bulletPoints: [
          'Show a compact pill/chip for each tool call: "Searching codebase..."',
          'Expand on tap/click to show details: parameters, results, timing',
          'Use distinct icons for different tool types: search, file, API, code',
          'Show a timeline view for multi-step tool chains',
          'Indicate success/failure with color coding (green/red)',
          'Allow users to inspect tool results without cluttering the main response',
        ],
      },
      {
        title: 'Prompt Input Design',
        content:
          'The prompt input is the most important UI element in an AI application. It needs to support complex inputs while remaining approachable. Great prompt inputs guide users toward better prompts.',
        bulletPoints: [
          'Auto-expanding textarea that grows with content (not a fixed single line)',
          'Support file attachments, images, and code blocks in the input',
          'Show suggested prompts or "try asking..." hints for new users',
          'Keyboard shortcuts: Enter to send, Shift+Enter for newline',
          'Character/token count indicator for context-aware usage',
          'Recent prompt history accessible via up-arrow key',
        ],
      },
    ],
  },
  {
    id: 'bento-layouts',
    title: 'Bento Grid Layouts',
    subtitle: 'CSS Grid masonry techniques, responsive breakpoints, and the bento box design trend.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['css', 'layout'],
    content: [
      {
        title: 'What Is Bento Layout?',
        content:
          'Bento layouts (named after Japanese bento boxes) are grid-based designs where cards of varying sizes fit together in a visually pleasing mosaic. Popularized by Apple\'s keynote slides and modern dashboard designs, bento grids break the monotony of uniform card layouts. Each cell can span different numbers of rows and columns, creating visual hierarchy through size rather than just positioning.',
        bulletPoints: [
          'Named after the compartmentalized Japanese lunch boxes',
          'Cards of varying sizes create visual hierarchy and interest',
          'Popularized by Apple keynotes, Notion, and modern dashboards',
          'Uses CSS Grid with span declarations for flexible sizing',
          'Naturally draws attention to featured/important content via larger cells',
        ],
      },
      {
        title: 'CSS Grid Implementation',
        content:
          'Bento layouts are built with CSS Grid. Define a grid with evenly-spaced columns, then use grid-column and grid-row spans to size individual cards. The key is a consistent gap and border-radius for the bento box aesthetic.',
        codeExample: `/* Bento Grid Container */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 180px;
  gap: 16px;
  padding: 16px;
}

/* Card sizes */
.bento-card { border-radius: 16px; padding: 24px; }
.bento-card--wide { grid-column: span 2; }
.bento-card--tall { grid-row: span 2; }
.bento-card--large { grid-column: span 2; grid-row: span 2; }
.bento-card--full { grid-column: span 4; }

/* Responsive breakpoints */
@media (max-width: 1024px) {
  .bento-grid { grid-template-columns: repeat(3, 1fr); }
  .bento-card--full { grid-column: span 3; }
}

@media (max-width: 768px) {
  .bento-grid { grid-template-columns: repeat(2, 1fr); }
  .bento-card--wide { grid-column: span 2; }
  .bento-card--large { grid-column: span 2; }
  .bento-card--full { grid-column: span 2; }
}

@media (max-width: 480px) {
  .bento-grid { grid-template-columns: 1fr; }
  .bento-card--wide,
  .bento-card--large,
  .bento-card--full { grid-column: span 1; }
}`,
      },
      {
        title: 'Design Guidelines',
        content:
          'A great bento layout follows specific design principles that separate it from a random grid of cards.',
        bulletPoints: [
          'Consistent gap size (12-20px) -- this creates the "compartment" feeling',
          'Generous border-radius (12-20px) for the modern rounded aesthetic',
          'Limit card sizes to 4-5 variants for visual consistency',
          'Use the largest card for the most important content',
          'Alternate card colors or subtle gradients for visual distinction',
          'Ensure the layout remains scannable -- large cards should not dominate on mobile',
        ],
      },
      {
        title: 'CSS Masonry (Upcoming)',
        content:
          'CSS Masonry is an upcoming CSS Grid feature that automatically packs items into columns without explicit row spans, similar to Pinterest-style layouts. This will make bento-style layouts even easier to build without JavaScript.',
        codeExample: `/* CSS Masonry (in development - available behind flags) */
.masonry-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: masonry;  /* The magic property */
  gap: 16px;
}

/* Items naturally pack into available space */
.masonry-item {
  border-radius: 16px;
  /* Height is determined by content -- no row spans needed */
}`,
        bulletPoints: [
          'grid-template-rows: masonry auto-packs items vertically',
          'No JavaScript needed for waterfall layouts',
          'Currently behind flags in Firefox and Safari',
          'Will simplify bento layouts dramatically once widely supported',
        ],
      },
    ],
  },
  {
    id: 'design-systems',
    title: 'Modern Design Systems',
    subtitle: 'Design tokens, shadcn/ui, headless UI, and compound component patterns for scalable UI.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['system', 'tokens', 'components'],
    content: [
      {
        title: 'What Is a Design System?',
        content:
          'A design system is the single source of truth for a product\'s UI. It includes design tokens (colors, spacing, typography), reusable components, usage guidelines, and accessibility standards. Modern design systems have shifted from monolithic component libraries to composable, headless approaches that separate behavior from styling.',
        bulletPoints: [
          'Design tokens: the atomic values (colors, spacing, radius, typography)',
          'Components: reusable UI building blocks with consistent behavior',
          'Patterns: solutions for common UX problems (forms, navigation, modals)',
          'Guidelines: documentation on when and how to use each piece',
          'Accessibility: built-in a11y compliance (ARIA, keyboard navigation, focus)',
        ],
      },
      {
        title: 'Design Tokens',
        content:
          'Design tokens are the foundation of any design system. They are named values that represent design decisions -- colors, spacing, font sizes, border radii, shadows, and more. By using tokens instead of raw values, you ensure consistency and enable theming.',
        codeExample: `// Design tokens as a typed system
const tokens = {
  colors: {
    gray: {
      50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5',
      300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373',
      600: '#525252', 700: '#404040', 800: '#262626',
      900: '#171717', 950: '#0a0a0a',
    },
    primary: {
      50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe',
      500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
    },
  },
  spacing: {
    xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48,
  },
  radius: {
    sm: 6, md: 8, lg: 12, xl: 16, full: 9999,
  },
  typography: {
    heading: { fontFamily: 'Inter', fontWeight: 700 },
    body: { fontFamily: 'Inter', fontWeight: 400 },
    mono: { fontFamily: 'JetBrains Mono', fontWeight: 400 },
  },
} as const;`,
        bulletPoints: [
          'Use semantic names: "primary-500" not "#6366f1"',
          'Layer tokens: primitive (gray-500) -> semantic (text-muted) -> component (button-text)',
          'Keep spacing on a consistent scale (4px base unit is common)',
          'Define tokens in a platform-agnostic format, then generate for CSS, JS, iOS, Android',
        ],
      },
      {
        title: 'shadcn/ui Approach',
        content:
          'shadcn/ui popularized a radically different approach: instead of installing a component library from npm, you copy component source code directly into your project. Components are built on Radix UI primitives (for accessibility) and styled with Tailwind CSS (for flexibility). You own the code completely and can modify anything.',
        bulletPoints: [
          'Copy-paste, not install -- components live in your codebase',
          'Built on Radix UI for accessible, headless primitives',
          'Styled with Tailwind CSS -- fully customizable',
          'CLI tool (npx shadcn add button) to scaffold components',
          'Growing ecosystem: charts, forms, tables, and more',
          'Theming via CSS variables -- easy dark mode and brand customization',
        ],
      },
      {
        title: 'Headless UI Libraries',
        content:
          'Headless UI libraries provide behavior and accessibility without any styling. This gives you complete control over appearance while getting complex interactions (dropdowns, modals, tabs, etc.) handled correctly.',
        tableData: {
          headers: ['Library', 'Framework', 'Approach', 'Styling'],
          rows: [
            ['Radix UI', 'React', 'Headless primitives', 'Bring your own'],
            ['Headless UI', 'React / Vue', 'Headless components', 'Bring your own'],
            ['Ark UI', 'React / Vue / Solid', 'State machines', 'Bring your own'],
            ['shadcn/ui', 'React', 'Radix + Tailwind', 'Tailwind (customizable)'],
            ['Chakra UI', 'React', 'Styled components', 'Built-in theme'],
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // OPEN SOURCE
  // ===========================================================================
  {
    id: 'local-models',
    title: 'Running Models Locally',
    subtitle: 'A guide to Ollama, llama.cpp, LM Studio, and running AI models on your own hardware.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['local', 'inference', 'ollama'],
    content: [
      {
        title: 'Why Run Models Locally?',
        content:
          'Running AI models on your own hardware gives you complete control over your data, eliminates API costs, works offline, and enables customization not possible with hosted services. With recent advances in model quantization and efficient inference engines, running capable models locally is more accessible than ever -- even consumer GPUs can run high-quality 7B-70B models.',
        bulletPoints: [
          'Privacy: your data never leaves your machine',
          'Cost: no per-token API charges after initial hardware investment',
          'Offline: works without internet, great for air-gapped environments',
          'Customization: fine-tune, quantize, and modify models freely',
          'Latency: no network round-trip -- responses can be extremely fast',
        ],
      },
      {
        title: 'Ollama -- The Easy Way',
        content:
          'Ollama is the most user-friendly way to run models locally. It provides a simple CLI with a Docker-like model management system. Download a model, run it -- that is it. Ollama handles quantization, GPU acceleration, and serving an OpenAI-compatible API automatically.',
        codeExample: `# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull and run a model
ollama pull llama3.1:8b
ollama run llama3.1:8b

# List installed models
ollama list

# Run with specific options
ollama run qwen3.5:14b --ctx-size 32768

# Serve an OpenAI-compatible API (auto-starts)
# POST http://localhost:11434/v1/chat/completions
curl http://localhost:11434/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
        bulletPoints: [
          'One command to download and run any supported model',
          'Automatic GPU detection and acceleration (CUDA, Metal, ROCm)',
          'OpenAI-compatible REST API at localhost:11434',
          'Model library with hundreds of pre-quantized models',
          'Supports custom Modelfiles for configuration',
        ],
      },
      {
        title: 'llama.cpp -- Maximum Performance',
        content:
          'llama.cpp is a C/C++ inference engine that runs GGUF-format models with maximum efficiency. It is the foundation that many other tools (including Ollama) build upon. For users who want the highest performance and most control, llama.cpp provides direct access to quantization, batch processing, and GPU offloading.',
        bulletPoints: [
          'Pure C/C++ with no dependencies -- runs on anything',
          'GGUF format: single-file models with metadata',
          'Quantization from Q2 to Q8 for different quality/speed trade-offs',
          'GPU offloading: split model layers between CPU and GPU',
          'Server mode with OpenAI-compatible API',
          'Speculative decoding for faster inference',
        ],
      },
      {
        title: 'Hardware Requirements',
        content:
          'The hardware you need depends on model size and quantization level. As a rule of thumb, you need roughly 0.5-1GB of RAM per billion parameters at Q4 quantization.',
        tableData: {
          headers: ['Model Size', 'Q4 RAM', 'Recommended GPU', 'Speed (tokens/sec)'],
          rows: [
            ['3B', '~2 GB', 'Any GPU / CPU only', '40-80 t/s'],
            ['7-8B', '~4-5 GB', '8GB VRAM (RTX 3060)', '30-50 t/s'],
            ['14B', '~8 GB', '12GB VRAM (RTX 3060 Ti)', '20-35 t/s'],
            ['32B', '~18 GB', '24GB VRAM (RTX 4090)', '15-25 t/s'],
            ['70B', '~40 GB', '48GB+ VRAM or dual GPU', '8-15 t/s'],
          ],
        },
      },
      {
        title: 'LM Studio',
        content:
          'LM Studio provides a polished desktop application for running models locally. It includes a built-in model browser, chat interface, and OpenAI-compatible API server. It is ideal for users who prefer a graphical interface over command-line tools.',
        bulletPoints: [
          'Desktop GUI for macOS, Windows, and Linux',
          'Built-in model search and download from Hugging Face',
          'Visual chat interface with conversation management',
          'OpenAI-compatible API server for integration with other tools',
          'Supports GGUF, GGML, and other quantization formats',
        ],
      },
    ],
  },
  {
    id: 'fine-tuning',
    title: 'Fine-Tuning Guide',
    subtitle: 'How to customize AI models with Unsloth, QLoRA, TRL, and proper data preparation.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['training', 'fine-tune'],
    content: [
      {
        title: 'What Is Fine-Tuning?',
        content:
          'Fine-tuning is the process of further training a pre-trained model on your own data to specialize it for a specific task or domain. Instead of training from scratch (which costs millions), you start with a capable base model and teach it your particular patterns, terminology, or preferences. Modern techniques like LoRA and QLoRA make fine-tuning possible on a single consumer GPU.',
        bulletPoints: [
          'Start with a pre-trained model and adapt it to your needs',
          'Much cheaper than training from scratch -- hours instead of months',
          'Teach domain-specific knowledge, style, or format',
          'LoRA/QLoRA: train only a tiny fraction of parameters (0.1-1%)',
          'Can be done on a single GPU with 16-24GB VRAM',
        ],
      },
      {
        title: 'Data Preparation',
        content:
          'The quality of your fine-tuning data is the single most important factor. Garbage in, garbage out. Your dataset should be diverse, high-quality, and formatted in the conversation format the model expects. Most models use the ChatML or similar instruction-following format.',
        codeExample: `# Training data format (JSONL - one example per line)
{"messages": [
  {"role": "system", "content": "You are a legal assistant specializing in contract law."},
  {"role": "user", "content": "What is a force majeure clause?"},
  {"role": "assistant", "content": "A force majeure clause is a contractual provision..."}
]}

# Data preparation script
import json
from datasets import Dataset

def prepare_dataset(raw_data):
    """Convert raw Q&A pairs to chat format."""
    formatted = []
    for item in raw_data:
        formatted.append({
            "messages": [
                {"role": "system", "content": "You are a helpful domain expert."},
                {"role": "user", "content": item["question"]},
                {"role": "assistant", "content": item["answer"]},
            ]
        })
    return Dataset.from_list(formatted)`,
        bulletPoints: [
          'Aim for 500-10,000 high-quality examples (more is not always better)',
          'Diverse examples covering the range of expected inputs',
          'Consistent formatting -- use the model\'s expected chat template',
          'Clean data: remove duplicates, fix errors, validate formatting',
          'Include edge cases and negative examples',
        ],
      },
      {
        title: 'Fine-Tuning with Unsloth',
        content:
          'Unsloth is the fastest and most memory-efficient fine-tuning library, achieving 2-5x speedup over standard methods. It supports QLoRA (quantized LoRA) which allows fine-tuning large models on consumer GPUs by keeping the base model in 4-bit precision while training small adapter layers in full precision.',
        codeExample: `from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments

# Load model with 4-bit quantization
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-7B-Instruct",
    max_seq_length=2048,
    load_in_4bit=True,
)

# Add LoRA adapters (only these tiny layers get trained)
model = FastLanguageModel.get_peft_model(
    model,
    r=16,              # LoRA rank (higher = more capacity)
    lora_alpha=16,     # Scaling factor
    lora_dropout=0,    # Dropout for regularization
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
)

# Train
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=TrainingArguments(
        output_dir="./output",
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        num_train_epochs=3,
        learning_rate=2e-4,
        fp16=True,
    ),
)

trainer.train()

# Save and export
model.save_pretrained_merged("./merged_model", tokenizer)
# Or export to GGUF for llama.cpp/Ollama
model.save_pretrained_gguf("./gguf_model", tokenizer,
    quantization_method="q4_k_m")`,
      },
      {
        title: 'When to Fine-Tune vs. Prompt',
        content:
          'Fine-tuning is not always the answer. For many tasks, well-crafted prompts, few-shot examples, or RAG (retrieval-augmented generation) are more cost-effective. Fine-tuning is best when you need consistent style, domain-specific knowledge baked into the model, or faster inference (no long system prompts needed).',
        tableData: {
          headers: ['Approach', 'Best When', 'Effort', 'Cost'],
          rows: [
            ['Prompt Engineering', 'Task is well-defined, few patterns', 'Low', '$'],
            ['Few-Shot Examples', 'Need consistent format/style', 'Low', '$'],
            ['RAG', 'Need up-to-date or large knowledge base', 'Medium', '$$'],
            ['Fine-Tuning', 'Need specialized behavior or domain expertise', 'High', '$$$'],
            ['Pre-Training', 'Need new language or entirely new domain', 'Very High', '$$$$'],
          ],
        },
      },
    ],
  },
  {
    id: 'vector-databases',
    title: 'Vector Databases & RAG',
    subtitle: 'Embeddings, vector search, and retrieval-augmented generation with Chroma, Pinecone, and Qdrant.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['rag', 'vector', 'database'],
    content: [
      {
        title: 'What Is RAG?',
        content:
          'Retrieval-Augmented Generation (RAG) is a technique that enhances AI responses by retrieving relevant information from a knowledge base before generating a response. Instead of relying solely on the model\'s training data (which is static and potentially outdated), RAG systems search a vector database for relevant documents and include them in the prompt. This gives the model access to current, domain-specific information.',
        bulletPoints: [
          'Combines retrieval (search) with generation (LLM response)',
          'Enables AI to access current, private, or specialized data',
          'Reduces hallucination by grounding responses in real documents',
          'More cost-effective than fine-tuning for knowledge-heavy applications',
          'Knowledge base can be updated without retraining the model',
        ],
      },
      {
        title: 'How Embeddings Work',
        content:
          'Embeddings are the foundation of RAG. An embedding model converts text into dense numerical vectors that capture semantic meaning. Similar texts produce similar vectors, enabling semantic search -- finding relevant content based on meaning rather than keyword matching.',
        codeExample: `# Generate embeddings with OpenAI
from openai import OpenAI
client = OpenAI()

response = client.embeddings.create(
    model="text-embedding-3-small",
    input="How do I implement authentication in Next.js?"
)
vector = response.data[0].embedding  # [0.023, -0.041, 0.018, ...]
# 1536-dimensional vector capturing the semantic meaning

# With Sentence Transformers (local, free)
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
vectors = model.encode(["auth in Next.js", "login system React"])
# Cosine similarity reveals semantic relatedness`,
        bulletPoints: [
          'Each text chunk becomes a high-dimensional vector (768-3072 dimensions)',
          'Similar meanings produce similar vectors (close in vector space)',
          'Cosine similarity or dot product measures relatedness',
          'Different models produce different quality embeddings',
          'OpenAI, Cohere, and open-source models all offer embedding APIs',
        ],
      },
      {
        title: 'Vector Database Comparison',
        content:
          'Vector databases are specialized for storing, indexing, and querying embedding vectors at scale. They use approximate nearest neighbor (ANN) algorithms for fast similarity search.',
        tableData: {
          headers: ['Database', 'Type', 'Best For', 'Pricing'],
          rows: [
            ['Chroma', 'Embedded / Server', 'Prototyping, local dev, small-medium scale', 'Free (open source)'],
            ['Pinecone', 'Managed cloud', 'Production, serverless, zero-ops', 'Free tier + pay-per-use'],
            ['Qdrant', 'Self-hosted / Cloud', 'High performance, filtering, hybrid search', 'Free (open source) + cloud'],
            ['Weaviate', 'Self-hosted / Cloud', 'Multi-modal, GraphQL API', 'Free (open source) + cloud'],
            ['pgvector', 'PostgreSQL extension', 'When you already use Postgres', 'Free (extension)'],
          ],
        },
      },
      {
        title: 'Building a RAG Pipeline',
        content:
          'A typical RAG pipeline has two phases: indexing (preparing your knowledge base) and querying (retrieving relevant context for each user question).',
        codeExample: `# Simple RAG pipeline with Chroma
import chromadb
from openai import OpenAI

client = OpenAI()
chroma = chromadb.PersistentClient(path="./chroma_db")
collection = chroma.get_or_create_collection("docs")

# INDEXING PHASE: Add documents
documents = [
    "Next.js uses file-based routing in the app/ directory...",
    "Authentication can be implemented with NextAuth.js...",
    "Server Components run on the server and reduce bundle size...",
]

collection.add(
    documents=documents,
    ids=[f"doc_{i}" for i in range(len(documents))],
)

# QUERY PHASE: Retrieve and generate
def ask(question: str) -> str:
    # 1. Retrieve relevant documents
    results = collection.query(query_texts=[question], n_results=3)
    context = "\\n".join(results["documents"][0])

    # 2. Generate answer with context
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": f"Answer based on this context:\\n{context}"},
            {"role": "user", "content": question},
        ],
    )
    return response.choices[0].message.content

answer = ask("How do I add auth to my Next.js app?")`,
        bulletPoints: [
          'Chunk documents into 200-500 token segments with overlap',
          'Generate embeddings for each chunk and store in vector DB',
          'At query time, embed the question and find similar chunks',
          'Include top-k results as context in the LLM prompt',
          'Add metadata filtering for more precise retrieval',
        ],
      },
    ],
  },
  {
    id: 'hugging-face',
    title: 'Hugging Face Ecosystem',
    subtitle: 'The hub for open-source AI: models, datasets, Spaces, and the Inference API.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['platform', 'hub'],
    content: [
      {
        title: 'What Is Hugging Face?',
        content:
          'Hugging Face is the GitHub of machine learning. It is a platform where researchers and developers share models, datasets, and applications (Spaces). With over 500,000 models and 100,000 datasets, it is the central hub for the open-source AI community. Beyond hosting, Hugging Face provides the Transformers library (the most popular ML library), training tools, and inference infrastructure.',
        bulletPoints: [
          'Model Hub: 500K+ pre-trained models across all domains',
          'Datasets: 100K+ datasets for training and evaluation',
          'Spaces: hosted ML demos and applications (Gradio/Streamlit)',
          'Transformers library: unified API for all major model architectures',
          'Inference API: run any model via API without hosting infrastructure',
        ],
      },
      {
        title: 'The Model Hub',
        content:
          'The Model Hub is where the AI community shares pre-trained models. Every major open-source model is available here -- Llama, Qwen, Mistral, DeepSeek, Phi, and thousands more. Each model page includes documentation, benchmarks, usage examples, and community discussions.',
        bulletPoints: [
          'Search and filter by task, framework, language, and license',
          'Model cards document capabilities, limitations, and training details',
          'Versioning and automatic downloads via the transformers library',
          'Community contributions: quantized versions, fine-tuned variants',
          'Gated models: some require accepting license terms before download',
        ],
        codeExample: `# Using models from the Hub
from transformers import pipeline

# Text generation
generator = pipeline("text-generation", model="Qwen/Qwen3.5-8B-Instruct")
result = generator("Explain quantum computing:", max_length=200)

# Sentiment analysis
classifier = pipeline("sentiment-analysis")
result = classifier("I love this product!")
# [{'label': 'POSITIVE', 'score': 0.9998}]

# Using the Hub API
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(
    filter="text-generation",
    sort="downloads",
    direction=-1,
    limit=10,
)`,
      },
      {
        title: 'Spaces -- Hosted ML Apps',
        content:
          'Spaces let you deploy machine learning applications for free. Build interactive demos with Gradio or Streamlit, and Hugging Face handles the hosting, scaling, and GPU allocation. Spaces are great for showcasing models, building prototypes, and creating tools for non-technical users.',
        bulletPoints: [
          'Free hosting for Gradio and Streamlit applications',
          'Optional GPU acceleration (T4, A10G, A100)',
          'Docker support for custom applications',
          'Embed Spaces in other websites via iframe',
          'Community can duplicate and fork Spaces',
        ],
      },
      {
        title: 'Inference API & Endpoints',
        content:
          'Hugging Face provides two ways to run models without managing infrastructure: the free Inference API for prototyping and Inference Endpoints for production deployment.',
        tableData: {
          headers: ['Service', 'Use Case', 'Pricing', 'Features'],
          rows: [
            ['Inference API (Free)', 'Prototyping, testing', 'Free (rate limited)', 'Thousands of models, instant access'],
            ['Inference API (Pro)', 'Development', '$9/month', 'Higher limits, faster responses'],
            ['Inference Endpoints', 'Production', 'Per-hour GPU pricing', 'Dedicated infra, autoscaling, private'],
            ['Spaces', 'Demos, apps', 'Free (basic) / GPU upgrades', 'Full app hosting with UI'],
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // MCP
  // ===========================================================================
  {
    id: 'mcp-overview',
    title: 'What is MCP?',
    subtitle: 'The Model Context Protocol: an open standard connecting AI models to data, tools, and services.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['protocol', 'architecture'],
    content: [
      {
        title: 'MCP Explained',
        content:
          'The Model Context Protocol (MCP) is an open standard created by Anthropic that provides a universal way for AI models to interact with external tools, data sources, and services. Think of it as a "USB-C for AI" -- a single protocol that connects any AI client to any tool or data source. Before MCP, every AI application had to build custom integrations for each service. MCP standardizes this into a client-server architecture with a well-defined protocol.',
        bulletPoints: [
          'Open standard -- anyone can implement clients and servers',
          'Replaces custom one-off integrations with a universal protocol',
          'Clients: AI applications (Claude Code, Cursor, IDEs)',
          'Servers: tool providers (GitHub, databases, APIs, file systems)',
          'Supports tools (functions), resources (data), and prompts (templates)',
        ],
      },
      {
        title: 'Architecture',
        content:
          'MCP follows a client-server architecture. The Host is the AI application (like Claude Code). It contains an MCP Client that connects to one or more MCP Servers. Each server exposes tools, resources, and prompts through a standardized JSON-RPC protocol. Servers can be local processes (connected via stdio) or remote services (connected via HTTP/SSE).',
        bulletPoints: [
          'Host: the AI application that initiates connections',
          'Client: protocol handler inside the host, manages server connections',
          'Server: provides tools, resources, and prompts to the client',
          'Transport: stdio (local processes) or HTTP+SSE (remote services)',
          'JSON-RPC 2.0: the wire protocol for all communication',
        ],
        codeExample: `// MCP Architecture Diagram
//
// +-----------------------------------+
// |         Host (Claude Code)        |
// |  +-----------+  +-----------+     |
// |  | Client  1 |  | Client  2 |     |
// |  +-----+-----+  +-----+-----+    |
// +--------|--------------|-----------+
//          |              |
//    +-----+-----+  +----+------+
//    | MCP Server |  | MCP Server |
//    |  (GitHub)  |  | (Database) |
//    +-----------+  +-----------+`,
      },
      {
        title: 'Core Primitives',
        content:
          'MCP defines three types of capabilities that servers can expose to clients.',
        tableData: {
          headers: ['Primitive', 'Description', 'Example', 'Initiated By'],
          rows: [
            ['Tools', 'Functions the AI can call', 'create_issue, query_db, send_message', 'Model (via client)'],
            ['Resources', 'Data the AI can read', 'File contents, database records, API responses', 'Client (application)'],
            ['Prompts', 'Reusable prompt templates', 'Code review template, SQL query builder', 'User (via client)'],
          ],
        },
        bulletPoints: [
          'Tools: model-controlled actions -- the AI decides when to use them',
          'Resources: application-controlled data -- the host decides what to include',
          'Prompts: user-controlled templates -- the user selects and fills in parameters',
        ],
      },
      {
        title: 'Why MCP Matters',
        content:
          'MCP is transforming how AI applications integrate with the world. Instead of each AI tool building its own GitHub integration, database connector, or Slack bridge, MCP creates a shared ecosystem where a single server implementation works with every MCP-compatible client.',
        bulletPoints: [
          'Write one MCP server, use it in Claude Code, Cursor, and any MCP client',
          'Growing ecosystem: 100+ community MCP servers available',
          'Standardized security: authentication, authorization, and scoping',
          'Reduces integration maintenance burden for both sides',
          'Enables a marketplace of AI capabilities',
        ],
      },
      {
        title: 'Transport Types',
        content:
          'MCP supports two main transport mechanisms for communication between clients and servers. The choice depends on whether the server runs locally or remotely.',
        tableData: {
          headers: ['Transport', 'How It Works', 'Best For', 'Security'],
          rows: [
            ['stdio', 'Client spawns server as child process, communicates via stdin/stdout', 'Local tools, CLI integrations', 'Process isolation'],
            ['HTTP + SSE', 'Server runs on a URL, client connects via HTTP POST + SSE stream', 'Remote services, shared servers', 'HTTPS + auth tokens'],
          ],
        },
      },
    ],
  },
  {
    id: 'mcp-servers',
    title: 'Popular MCP Servers',
    subtitle: 'The most useful MCP servers: GitHub, Slack, databases, Playwright, and more.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['servers', 'integrations'],
    content: [
      {
        title: 'The MCP Server Ecosystem',
        content:
          'The MCP ecosystem has grown rapidly with hundreds of community-built servers covering development tools, databases, communication platforms, and more. These servers can be used with any MCP-compatible client (Claude Code, Cursor, etc.) to give AI agents access to your real tools and data.',
        bulletPoints: [
          'Most servers are npm packages -- install and configure in minutes',
          'Official servers maintained by Anthropic and major platforms',
          'Community servers cover nearly every popular service',
          'Configuration via JSON -- add to your MCP settings file',
          'Servers run locally or remotely depending on architecture',
        ],
      },
      {
        title: 'Essential Servers',
        content:
          'These are the most widely used MCP servers that cover common development workflows.',
        tableData: {
          headers: ['Server', 'Package', 'Capabilities'],
          rows: [
            ['GitHub', '@modelcontextprotocol/server-github', 'Issues, PRs, repos, code search, file contents'],
            ['Postgres', '@modelcontextprotocol/server-postgres', 'Query, schema inspection, data analysis'],
            ['Filesystem', '@modelcontextprotocol/server-filesystem', 'Read, write, search files with sandboxing'],
            ['Slack', '@modelcontextprotocol/server-slack', 'Send messages, search, read channels'],
            ['Playwright', '@playwright/mcp', 'Browser automation, screenshots, testing'],
            ['Memory', '@modelcontextprotocol/server-memory', 'Persistent knowledge graph across sessions'],
            ['Fetch', '@modelcontextprotocol/server-fetch', 'HTTP requests, web scraping, API calls'],
          ],
        },
      },
      {
        title: 'Configuration',
        content:
          'MCP servers are configured in a JSON settings file. Each server entry specifies the command to run, arguments, and optional environment variables. Here is how to set up common servers.',
        codeExample: `// ~/.claude/settings.json (for Claude Code)
// Or .mcp.json in project root
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    },
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://user:pass@localhost:5432/mydb"
      ]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/allowed/directory"
      ]
    }
  }
}`,
      },
      {
        title: 'Specialized Servers',
        content:
          'Beyond the essentials, the ecosystem includes specialized servers for specific domains and use cases.',
        tableData: {
          headers: ['Server', 'Domain', 'What It Does'],
          rows: [
            ['Sentry', 'Monitoring', 'Query errors, manage issues, analyze crash data'],
            ['Linear', 'Project Mgmt', 'Create/update issues, manage sprints'],
            ['Figma', 'Design', 'Read designs, extract styles, component info'],
            ['Stripe', 'Payments', 'Manage customers, subscriptions, invoices'],
            ['Supabase', 'Database', 'Query, manage tables, auth, storage'],
            ['Notion', 'Docs', 'Read/write pages, databases, blocks'],
          ],
        },
      },
      {
        title: 'Finding & Evaluating Servers',
        content:
          'The MCP ecosystem is growing rapidly. Here is where to find servers for your needs and how to evaluate them.',
        bulletPoints: [
          'Official list: github.com/modelcontextprotocol/servers',
          'MCP Hub: mcp.so -- searchable directory of community servers',
          'npm: search for "@modelcontextprotocol/server-" prefix',
          'GitHub: search for "mcp-server" repositories',
          'Check server README for required permissions and environment variables',
          'Prefer servers with active maintenance and TypeScript/Python implementations',
        ],
      },
    ],
  },
  {
    id: 'building-mcp',
    title: 'Building MCP Servers',
    subtitle: 'How to build custom MCP servers with Python FastMCP, TypeScript SDK, tools, and resources.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['development', 'tutorial'],
    content: [
      {
        title: 'Why Build an MCP Server?',
        content:
          'Building a custom MCP server lets you connect AI agents to your own tools, APIs, and data sources. If you have an internal API, a proprietary database, or a custom workflow, an MCP server makes it accessible to any AI client. The development experience is straightforward -- the Python and TypeScript SDKs handle the protocol details, so you just define your tools and resources.',
        bulletPoints: [
          'Connect AI agents to your internal tools and APIs',
          'One server works with all MCP-compatible clients',
          'SDKs handle protocol, transport, and message formatting',
          'You just define tools (functions) and resources (data)',
          'Can be deployed locally (stdio) or remotely (HTTP/SSE)',
        ],
      },
      {
        title: 'Python with FastMCP',
        content:
          'FastMCP is the recommended Python SDK for building MCP servers. It provides a Flask-like decorator API that makes server creation incredibly simple. Define functions with type hints, add a @tool or @resource decorator, and you have a working MCP server.',
        codeExample: `# pip install fastmcp
from fastmcp import FastMCP

mcp = FastMCP("My Custom Server")

@mcp.tool()
def search_docs(query: str, limit: int = 5) -> list[dict]:
    """Search our documentation for relevant articles.

    Args:
        query: The search query string
        limit: Maximum number of results to return
    """
    # Your actual search logic here
    results = my_search_engine.search(query, limit=limit)
    return [{"title": r.title, "url": r.url, "snippet": r.snippet}
            for r in results]

@mcp.tool()
def create_ticket(
    title: str, description: str, priority: str = "medium"
) -> dict:
    """Create a support ticket in our internal system.

    Args:
        title: Brief title for the ticket
        description: Detailed description of the issue
        priority: Priority level (low, medium, high, critical)
    """
    ticket = ticket_system.create(
        title=title, description=description, priority=priority
    )
    return {"id": ticket.id, "url": ticket.url, "status": "created"}

@mcp.resource("docs://api-reference")
def get_api_docs() -> str:
    """Return the full API reference documentation."""
    return open("api-reference.md").read()

# Run the server
if __name__ == "__main__":
    mcp.run()  # Starts stdio transport by default`,
      },
      {
        title: 'TypeScript Implementation',
        content:
          'The TypeScript MCP SDK provides a similar experience for Node.js developers. Tools are defined with Zod schemas for parameter validation.',
        codeExample: `// npm install @modelcontextprotocol/sdk zod
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport }
  from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-custom-server",
  version: "1.0.0",
});

// Define a tool
server.tool(
  "search_docs",
  "Search documentation for relevant articles",
  {
    query: z.string().describe("The search query"),
    limit: z.number().default(5).describe("Max results"),
  },
  async ({ query, limit }) => {
    const results = await mySearchEngine.search(query, limit);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(results, null, 2),
      }],
    };
  }
);

// Define a resource
server.resource(
  "docs://api-reference",
  "API Reference Documentation",
  "text/markdown",
  async () => ({
    contents: [{
      uri: "docs://api-reference",
      text: await fs.readFile("api-reference.md", "utf-8"),
    }],
  })
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);`,
      },
      {
        title: 'Testing & Deployment',
        content:
          'Once your server is built, you can test it locally and then deploy it for others to use.',
        bulletPoints: [
          'Test with the MCP Inspector: npx @modelcontextprotocol/inspector',
          'Add to Claude Code config for real-world testing',
          'Publish to npm for easy distribution',
          'For remote deployment, use HTTP+SSE transport instead of stdio',
          'Add authentication for sensitive tools (API keys, OAuth)',
          'Document your tools clearly -- the AI reads your descriptions to decide when to use them',
        ],
        codeExample: `# Test your server with the MCP Inspector
npx @modelcontextprotocol/inspector python my_server.py

# Or test with Claude Code by adding to settings
# ~/.claude/settings.json
{
  "mcpServers": {
    "my-server": {
      "command": "python",
      "args": ["path/to/my_server.py"]
    }
  }
}

# For remote deployment (HTTP transport)
# Python:
mcp.run(transport="sse", host="0.0.0.0", port=8080)`,
      },
      {
        title: 'Best Practices',
        content:
          'Follow these guidelines to build MCP servers that work reliably with AI agents.',
        bulletPoints: [
          'Write clear, specific tool descriptions -- the AI uses them to decide when to call your tool',
          'Use descriptive parameter names and add descriptions to every parameter',
          'Return structured data (JSON) rather than free-form text when possible',
          'Handle errors gracefully and return helpful error messages',
          'Keep tools focused -- one tool per action, not mega-tools that do everything',
          'Add rate limiting and input validation for production servers',
        ],
      },
    ],
  },
  {
    id: 'frontier-ai-labs-2026',
    title: 'Frontier AI Labs In 2026',
    subtitle: 'What OpenAI, Anthropic, Google DeepMind, and Meta FAIR are prioritizing now, and what those agendas mean for builders.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    tags: ['research', 'labs', 'openai', 'anthropic', 'deepmind', 'meta', '2026'],
    content: [
      {
        title: 'Why Track Research Labs As Agendas, Not Just Brands',
        content:
          'A useful AI wiki should not treat frontier labs as interchangeable model vendors. Each lab is making different bets about what intelligence should look like in products and infrastructure. The highest-signal way to track them is to watch their research agenda: coding agents, long-horizon work, computer use, scientific reasoning, open-weight ecosystems, perception systems, and interpretability or safety scaffolding.',
        bulletPoints: [
          'OpenAI is pushing integrated reasoning, coding, tool search, and computer-use into one mainline stack',
          'Anthropic is pushing long-horizon agentic work, context management, and multi-agent coordination',
          'Google DeepMind is pushing science-grade reasoning, multimodality, and specialized technical performance',
          'Meta FAIR is pushing open research artifacts, open models, perception systems, and world-model style capability',
        ],
      },
      {
        title: 'OpenAI: Professional Work, Tool Search, And Computer Use',
        content:
          'On March 5, 2026, OpenAI introduced GPT-5.4 as its most capable frontier model for professional work. The important signal is not only benchmark movement. It is that OpenAI is collapsing reasoning, coding, agent workflows, high-context work, and computer use into one model line. GPT-5.4 is positioned as a model that can plan, operate across tools, handle software environments, and sustain longer task horizons with up to 1 million tokens of context. That points toward a product strategy where the best model is not just a better answer engine, but a stronger operator across connected software systems.',
        bulletPoints: [
          'Official source: OpenAI, “Introducing GPT-5.4,” March 5, 2026',
          'Key themes: 1M-token context, native computer use, stronger coding, stronger tool search',
          'Product implication: OpenAI is optimizing for agent runtime reliability, not only chat quality',
          'What builders should watch: workflow completion, connector/tool discovery, and long-context verification patterns',
        ],
      },
      {
        title: 'Anthropic: Longer Tasks, Context Compaction, And Agent Teams',
        content:
          'On February 5, 2026, Anthropic introduced Claude Opus 4.6 and made the strategic direction unusually clear. The model is framed around planning carefully, sustaining longer coding and knowledge-work tasks, operating more reliably in large codebases, and coordinating richer agentic workflows. Anthropic also paired the model with context compaction, adaptive thinking, effort controls, and research-preview agent teams in Claude Code. That means Anthropic is not only improving model intelligence. It is investing in the runtime mechanics that let one model or multiple sub-agents keep going without collapsing under long context windows.',
        bulletPoints: [
          'Official source: Anthropic, “Introducing Claude Opus 4.6,” February 5, 2026',
          'Key themes: long-horizon coding, 1M-token context beta, context compaction, adaptive thinking, agent teams',
          'Product implication: Anthropic is treating context management and delegation as core product capability',
          'What builders should watch: specialist agents, context summarization, and multi-run orchestration instead of single-turn prompting',
        ],
      },
      {
        title: 'Google DeepMind: Science, Engineering, And Multimodal Reasoning',
        content:
          'Google DeepMind is emphasizing a different frontier story: scientific and engineering rigor. In February 2026, DeepMind published Gemini 3.1 Pro as its most advanced model for complex tasks and highlighted Deep Think as its most specialized reasoning mode for science, research, and engineering. Across official pages and model cards, the messaging is consistent: very large multimodal context, hard technical problem solving, programming and mathematical performance, and deployment into scientific and engineering workflows. This is the clearest signal that Google DeepMind wants to own the “AI for research and technical discovery” lane, not only consumer productivity.',
        bulletPoints: [
          'Official sources: Google DeepMind, “Gemini 3.1 Pro” model card (published February 19, 2026); Gemini Deep Think pages and February 11, 2026 research post',
          'Key themes: multimodal reasoning, scientific problem solving, programming and math rigor, evaluation-heavy positioning',
          'Product implication: DeepMind is optimizing for technical depth and science-facing workflows',
          'What builders should watch: multimodal repo comprehension, scientific assistants, and domain-specific reasoning performance',
        ],
      },
      {
        title: 'Meta FAIR: Open Research, Perception, And World Models',
        content:
          'Meta FAIR still matters because it is shaping the open side of the ecosystem. Its public positioning centers on open source AI, research artifacts, and the idea that broadly available models and datasets accelerate innovation. The most revealing recent signals are not only model families like Llama. They are FAIR’s research pushes in perception and world modeling, such as V-JEPA 2 in June 2025, along with ongoing work in segmentation, visual understanding, and iterative multimodal generation. Meta is less focused on one vertically integrated assistant product and more focused on seeding capability into the broader ecosystem through open-weight models, research releases, and platform spread.',
        bulletPoints: [
          'Official sources: Meta AI open source AI hub; Meta FAIR “Introducing V-JEPA 2” and related 2025 perception/localization releases',
          'Key themes: open-weight diffusion of capability, perception systems, world models, research artifacts, ecosystem leverage',
          'Product implication: Meta keeps strengthening the open infrastructure layer that other builders can compose into products',
          'What builders should watch: open model quality, perception stacks, robotics/world-model work, and deployable research artifacts',
        ],
      },
      {
        title: 'Model Snapshot: What Each Lab Is Shipping Into Products',
        content:
          'One practical way to compare labs is to look at the models they are turning into product surfaces right now. The pattern is clear: OpenAI and Anthropic are making coding and long-horizon execution central, Google DeepMind is making scientific and multimodal reasoning central, and Meta is making open-weight capability and perception central.',
        tableData: {
          headers: ['Lab', 'Current Model Signal', 'What It Is Best Framed For', 'What Builders Should Learn'],
          rows: [
            ['OpenAI', 'GPT-5.4', 'Professional work, coding, tool search, computer use, very long context', 'Design for tool execution and end-to-end workflow completion'],
            ['Anthropic', 'Claude Opus 4.6 / Sonnet 4.6', 'Long-horizon coding, review, delegation, context-heavy work', 'Design for context compaction, delegation, and durable task state'],
            ['Google DeepMind', 'Gemini 3.1 Pro / Deep Think', 'Science, engineering, multimodality, technical reasoning', 'Design for multimodal technical workflows and domain-specific reasoning'],
            ['Meta FAIR', 'Llama 4 + FAIR perception/world-model work', 'Open deployment, perception, ecosystem leverage', 'Design for composability, controllable infra, and open-weight customization'],
          ],
        },
      },
      {
        title: 'Interactive Example: Turn Lab Research Into Product Questions',
        content:
          'A good wiki article should not only summarize research. It should help the reader use it. The easiest way to do that is to turn each lab agenda into product questions a builder can actually ask while designing a feature.',
        codeExample: `Prompt drill: "I want to build a coding assistant for this app. Which frontier lab agenda should influence the architecture most?"

What to look for in the answer:
- OpenAI lens: Do I need tool search, computer use, and one strong general model?
- Anthropic lens: Do I need sub-agents, context compaction, and long task memory?
- DeepMind lens: Do I need stronger multimodal understanding or scientific/technical depth?
- Meta lens: Do I need open-weight deployment, perception, or lower-cost infrastructure control?

Better follow-up:
"Map this feature idea across OpenAI, Anthropic, DeepMind, and Meta-style product bets, then tell me which runtime patterns I should steal."`,
      },
      {
        title: 'The Real Cross-Lab Shift',
        content:
          'Across these labs, the shared trend is that frontier value is moving from “answer quality” toward “system quality.” The winning research agendas are converging on a few durable ingredients: better coding execution, stronger long-horizon reasoning, more usable tools, multimodal context, verification, and runtime patterns that let systems operate for longer without degrading. The labs still differ in style, but they are no longer competing only on chatbot polish. They are competing on who can make AI behave like a dependable working system.',
        bulletPoints: [
          'Agents are becoming first-class product surfaces',
          'Runtime and tool infrastructure now matter as much as the model',
          'Scientific and engineering use cases are becoming more central to frontier positioning',
          'Open ecosystems still matter because they shape deployment, cost, and control',
        ],
      },
    ],
  },
  {
    id: 'ai-university-research-fronts-2026',
    title: 'AI University Research Fronts',
    subtitle: 'What Stanford HAI, MIT CSAIL, Berkeley BAIR, and CMU are contributing that companies alone are not.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    tags: ['research', 'universities', 'stanford', 'mit', 'berkeley', 'cmu', '2026'],
    content: [
      {
        title: 'Why Schools Still Matter In The Frontier Era',
        content:
          'Industry now produces most notable frontier models, but universities remain essential because they work on the pieces companies often under-emphasize in product launches: measurement, transparency, interpretability, alignment methods, agent robustness, real-world deployment studies, and field-specific scientific infrastructure. If a wiki only tracks companies, it misses the institutions that are still defining how AI is evaluated, governed, and applied across disciplines.',
        bulletPoints: [
          'Universities are still strongest in evaluation, scientific rigor, interpretability, and public research artifacts',
          'Academic labs often surface failures, tradeoffs, and measurement gaps that product pages do not',
          'University work is often the clearest signal for what will become durable infrastructure rather than temporary hype',
        ],
      },
      {
        title: 'Stanford HAI: Measuring The Field, Not Just Building It',
        content:
          'Stanford HAI remains one of the most important institutions for understanding the field at system scale. The 2026 AI Index report, released in April 2026, is especially important because it reframes the frontier as an infrastructure and governance story, not just a model race. It reports that industry produced more than 90% of notable AI models in 2025, while transparency dropped, compute continued rising, open-source activity kept scaling, and AI research expanded across science and medicine. For builders, Stanford HAI is valuable because it provides the best high-level map of what is actually changing underneath the product layer.',
        bulletPoints: [
          'Official source: Stanford HAI, 2026 AI Index report and chapter pages',
          'Key themes: industry dominance, transparency decline, open-source scale, compute concentration, science adoption, policy expansion',
          'Product implication: AI product decisions now depend on infrastructure concentration, evaluation literacy, and policy awareness',
          'Best use of Stanford HAI material: treat it as the field-level dashboard for strategy and risk, not just an academic report',
        ],
      },
      {
        title: 'MIT CSAIL: Agent Search, Interpretability, And Model Science',
        content:
          'MIT CSAIL is especially strong where agent systems meet rigorous technical questions. Recent CSAIL work highlights automated interpretability agents, search-augmented agent programming, and deeper study of how models retrieve and use internal knowledge. The most practical signal for builders is that MIT keeps turning agent reliability problems into systems problems: how to search when models err, how to interpret what models are doing, and how to make long workflows more dependable. That is exactly the kind of work that becomes crucial once teams move past demos and into production AI systems.',
        bulletPoints: [
          'Official sources: CSAIL coverage of EnCompass (December 22, 2025), MAIA, and automated interpretability work',
          'Key themes: agent search/backtracking, automated interpretability, understanding model behavior at scale',
          'Product implication: robust agents need search, monitoring, and interpretability scaffolding, not just better prompts',
          'What to import into product architecture: retries, branch search, introspection, and evidence-oriented debugging',
        ],
      },
      {
        title: 'Berkeley BAIR: Real-World Reinforcement Learning And Embodied Systems',
        content:
          'Berkeley BAIR remains one of the clearest signals for how reinforcement learning and embodied AI leave the toy stage. A strong example is BAIR’s March 25, 2025 report on scaling reinforcement learning for traffic smoothing with a 100-autonomous-vehicle highway deployment. This is important because it shows BAIR still pushing AI into real systems where optimization, control, safety, and deployment constraints all matter at once. Berkeley continues to be one of the best places to watch if you care about robotics, embodied intelligence, real-world RL, and the engineering side of decision-making systems.',
        bulletPoints: [
          'Official source: BAIR blog, “Scaling Up Reinforcement Learning for Traffic Smoothing: A 100-AV Highway Deployment,” March 25, 2025',
          'Key themes: deployment-grade RL, embodied systems, control under real-world constraints, safety-performance tradeoffs',
          'Product implication: when agents move from text tasks to physical or operational systems, simulation and deployment quality dominate',
          'What builders should learn here: agentic systems are easier to trust when they are grounded in measurable environment feedback',
        ],
      },
      {
        title: 'CMU: Breadth Across Agents, Alignment, Retrieval, And Efficiency',
        content:
          'Carnegie Mellon’s machine learning ecosystem matters because it consistently covers a wide spread of modern AI research fronts rather than only one niche. Its 2025 conference overviews show strong activity in AI/LLM agents, code models, retrieval-augmented systems, interpretability, multilinguality, alignment, and efficiency. The important signal is not a single headline model. It is that CMU remains a broad and durable generator of methods, benchmarks, and talent across the entire language-model stack. For a product team, CMU is a strong indicator of where the next wave of practical research abstractions will come from.',
        bulletPoints: [
          'Official sources: ML@CMU overviews for ICLR 2025, EMNLP 2025, and NeurIPS 2025',
          'Key themes: agents, code models, retrieval, alignment, interpretability, multilinguality, efficiency',
          'Product implication: the future stack will be assembled from many method advances, not one magic model release',
          'Best use of CMU coverage: track research breadth to see which subfields are accelerating together',
        ],
      },
      {
        title: 'Research Fronts To Turn Into Product Experiments',
        content:
          'The best way to use university research is to convert it into experiments inside the product, not just admire it from a distance. Stanford HAI suggests what to measure at field scale. MIT suggests how to improve runtime reliability. Berkeley suggests where feedback-rich environments matter. CMU suggests which method clusters are maturing at once.',
        tableData: {
          headers: ['Institution', 'Research Front', 'Product Experiment To Try'],
          rows: [
            ['Stanford HAI', 'Ecosystem measurement and transparency', 'Track model/provider transparency and evaluation evidence in internal model selection'],
            ['MIT CSAIL', 'Agent search and interpretability', 'Add retries, branch search, and introspection summaries to long OpenSwan runs'],
            ['Berkeley BAIR', 'Embodied/RL deployment thinking', 'Use closed-loop verification and environment feedback instead of one-shot agent execution'],
            ['CMU', 'Agents + retrieval + efficiency breadth', 'Benchmark combinations of retrieval, planning, and small-model assistance rather than relying on one large model'],
          ],
        },
      },
      {
        title: 'Interactive Example: Use A University Lens On A Feature',
        content:
          'If you want the wiki to teach judgment, not just facts, every research trend should come with a way to apply it. This drill turns academic directions into concrete product review prompts.',
        codeExample: `Feature review drill:
"I want OpenSwan to handle long coding tasks better. Review the problem through four lenses:
1. Stanford HAI: what should we measure?
2. MIT CSAIL: what runtime reliability or interpretability mechanisms are missing?
3. Berkeley BAIR: where do we need feedback loops instead of one-shot execution?
4. CMU: which method combinations should we test together?"

Expected output:
- metrics to add
- runtime upgrades to add
- evaluation loop ideas
- research-inspired experiments worth shipping`,
      },
      {
        title: 'What Universities Add That Labs Usually Do Not',
        content:
          'The major labs are building the most visible systems, but universities are still where the field gets legible. Stanford HAI measures the ecosystem. MIT CSAIL studies reliability and interpretability. Berkeley BAIR pushes embodied and reinforcement learning into real settings. CMU keeps broad pressure on agents, language, retrieval, and evaluation. Together, these institutions fill the gaps left by product-led frontier development: public measurement, reproducibility, method diversity, and research that is valuable even when it is not immediately monetizable.',
        bulletPoints: [
          'Use industry sources to track capability pushes',
          'Use university sources to track rigor, measurement, and blind spots',
          'A strong wiki should combine both because product quality depends on both',
        ],
      },
    ],
  },
  {
    id: 'agent-evals-interpretability-2026',
    title: 'Agent Evals & Interpretability In 2026',
    subtitle: 'How top labs are making agent systems more measurable, debuggable, and trustworthy beyond demo quality.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    tags: ['evals', 'interpretability', 'reliability', 'agents', 'alignment', '2026'],
    content: [
      {
        title: 'Why This Matters Now',
        content:
          'The AI field is moving from “can the model answer well?” to “can the system complete work reliably?” That shift makes evaluations and interpretability much more important. If an agent writes code, calls tools, runs tests, or delegates to specialists, the product needs a way to measure success, inspect failure, and understand whether behavior is improving or drifting.',
        bulletPoints: [
          'Evals are how teams separate impressive demos from dependable systems',
          'Interpretability is how teams understand why a system behaves well or badly',
          'Agent products need both, because tool use and long-horizon work create more failure modes than single-turn chat',
        ],
      },
      {
        title: 'OpenAI: Preparedness, System Cards, And Scalable Testing',
        content:
          'OpenAI’s strongest public signal here is not a single paper but its evaluation and governance stack. On April 15, 2025, OpenAI published an updated Preparedness Framework that sharpened risk categories, defined operational thresholds, and emphasized scalable evaluations that can keep up with faster model iteration. Around the same time, OpenAI system cards for reasoning and tool-using models increasingly framed capability together with safety testing, red teaming, and evaluation reporting. The lesson for builders is simple: a serious agent runtime should have repeatable checks and deployment gates, not just prompt tweaks.',
        bulletPoints: [
          'Official sources: OpenAI Preparedness Framework update (April 15, 2025) and OpenAI o3/o4-mini System Card (April 16, 2025)',
          'Key themes: scalable evals, expert deep dives, deployment thresholds, tool-using model assessment',
          'Product implication: agent systems need explicit verification and release criteria',
        ],
      },
      {
        title: 'Anthropic: Mechanistic Interpretability And Character Control',
        content:
          'Anthropic has one of the clearest public interpretability programs in frontier AI. Its interpretability team positions “safety through understanding” as a core goal, and its recent work covers circuit tracing, hidden objective audits, persona vectors, introspection, and the assistant axis for stabilizing model character. The important product lesson is that agent quality is not only about getting better outputs. It is also about understanding the internal tendencies that create sycophancy, drift, hidden goals, or unstable personality under pressure.',
        bulletPoints: [
          'Official source: Anthropic Interpretability Research hub and 2025-2026 publications',
          'Key themes: tracing model reasoning, monitoring hidden objectives, controlling persona drift, understanding character stability',
          'Product implication: specialist agents need monitored behavior, not only stronger prompts',
        ],
      },
      {
        title: 'Universities: Measurement, Transparency, And Runtime Rigor',
        content:
          'Universities continue to supply the rigor layer that product launches often skip. Stanford HAI’s AI Index keeps the field measurable at ecosystem scale. MIT CSAIL keeps turning agent reliability into systems questions like search, debugging, and interpretability. CMU and similar research ecosystems keep pressure on evaluation breadth across agents, code models, retrieval, efficiency, and real-world deployment. If frontier labs define the capability race, universities help define whether anyone can really trust and compare the results.',
        bulletPoints: [
          'Stanford HAI is strongest at field-level measurement and trend visibility',
          'MIT CSAIL is strongest where agent reliability meets systems design and interpretability',
          'CMU and peer labs matter because they broaden the benchmark and methods conversation beyond a single company stack',
        ],
      },
      {
        title: 'What To Measure In A Coding Agent',
        content:
          'A coding agent should be measured as a workflow system, not just a chat system. That means you care about whether it selected the right tools, changed the right files, passed verification, recovered from failure, and produced an understandable artifact trail. Teams that only track thumbs-up or vibe-based quality will not know why performance changes over time.',
        tableData: {
          headers: ['Layer', 'What To Measure', 'Why It Matters'],
          rows: [
            ['Planning', 'task classification, tool plan quality, delegation choice', 'Shows whether the agent starts from the right execution posture'],
            ['Execution', 'tool success rate, command failure rate, retry rate', 'Shows whether the runtime can actually operate'],
            ['Verification', 'typecheck pass rate, test pass rate, preview success', 'Shows whether work is correct instead of merely plausible'],
            ['Review', 'false-positive review rate, missed-issue rate, fix success', 'Shows whether critique is useful or noisy'],
            ['User trust', 'reopen rate, manual takeover rate, accepted artifacts', 'Shows whether the agent is helping or creating cleanup work'],
          ],
        },
      },
      {
        title: 'Interactive Example: Build A Real Eval Loop',
        content:
          'This article should help someone design a better runtime, not just admire research. The fastest way to do that is to turn eval thinking into a repeatable review prompt.',
        codeExample: `Agent eval drill:
"Review this coding-agent run and score it across planning, execution, verification, and trust.
Tell me:
1. what failed,
2. what was not measured,
3. what should become an automated check,
4. what part of the agent needs interpretability or monitoring."

Better follow-up:
"Design a minimal eval suite for this feature with pass/fail criteria, retry rules, and evidence we should store in the run ledger."`,
      },
      {
        title: 'The Practical Lesson',
        content:
          'The frontier is no longer just about who has the smartest model. It is about who can make an agent observable, steerable, and reliable under real workloads. Evals make systems measurable. Interpretability makes them legible. Without both, a team is mostly operating on taste and hope.',
        bulletPoints: [
          'Treat evaluation as product infrastructure, not a side task',
          'Treat interpretability as a debugging and governance advantage, not a research luxury',
          'The best agent systems will combine tool evidence, runtime traces, and targeted evals into one operating loop',
        ],
      },
    ],
  },
  {
    id: 'physical-ai-robotics-fronts-2026',
    title: 'Physical AI & Robotics Fronts',
    subtitle: 'How top labs and schools are turning multimodal models into systems that perceive, plan, and act in the physical world.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    tags: ['robotics', 'physical-ai', 'embodied', 'deepmind', 'mit', 'berkeley', 'cmu', '2026'],
    content: [
      {
        title: 'Why Physical AI Changes The Conversation',
        content:
          'Embodied AI forces the field to prove itself against the world instead of only against text benchmarks. A robot or physical agent has to perceive correctly, plan safely, use tools, adapt to feedback, and complete tasks under uncertainty. That makes robotics one of the clearest places to see which AI ideas are robust and which were only impressive in chat.',
        bulletPoints: [
          'Physical AI raises the bar on grounding, planning, safety, and feedback',
          'Embodied systems make simulation, verification, and deployment constraints unavoidable',
          'A serious AI wiki should connect robotics research back to agent runtime design',
        ],
      },
      {
        title: 'Google DeepMind: General-Purpose Robot Planning',
        content:
          'Google DeepMind’s robotics push is one of the clearest signs that frontier labs want AI agents to leave the browser and act in the world. In September 2025, DeepMind introduced Gemini Robotics 1.5 and Gemini Robotics-ER 1.5 as models that perceive, plan, think, use tools, and act across complex multi-step physical tasks. The important lesson is not only “robots are getting smarter.” It is that the same agent design patterns showing up in coding systems — planning, tool use, long-horizon execution, explicit reasoning, and environment feedback — are becoming central in physical AI too.',
        bulletPoints: [
          'Official source: Google DeepMind, “Gemini Robotics 1.5 brings AI agents into the physical world,” September 25, 2025',
          'Key themes: vision-language-action models, embodied reasoning, digital tool use, multi-step plans, cross-embodiment transfer',
          'Product implication: agent runtimes should be built for action loops, not just response generation',
        ],
      },
      {
        title: 'MIT CSAIL: Generative Design Meets Physics',
        content:
          'MIT CSAIL’s June 27, 2025 robotics work is a useful counterpoint to pure language-model hype. Researchers combined generative AI with physics simulation to improve robot designs and test them before fabrication. That matters because it shows a broader pattern: high-value AI systems increasingly combine model generation with environment simulation and measurable feedback. For software builders, that maps directly to sandboxes, previews, tests, and verification loops.',
        bulletPoints: [
          'Official source: MIT CSAIL / MIT News, “Using generative AI to help robots jump higher and land better,” June 27, 2025',
          'Key themes: simulation-guided generation, design search, environment feedback, test-before-deploy',
          'Product implication: generated work should move through simulated or sandboxed verification whenever possible',
        ],
      },
      {
        title: 'Berkeley BAIR: Closed-Loop Deployment Thinking',
        content:
          'Berkeley BAIR remains especially important because it keeps proving that reinforcement learning and agent control only become trustworthy when they are closed-loop and deployed carefully. Its March 25, 2025 traffic smoothing deployment with 100 autonomous vehicles is a strong example. Even though it is not a chatbot story, it teaches a direct lesson for software agents: measurable environment feedback and staged deployment matter more than one-shot cleverness.',
        bulletPoints: [
          'Official source: BAIR blog, “Scaling Up Reinforcement Learning for Traffic Smoothing: A 100-AV Highway Deployment,” March 25, 2025',
          'Key themes: deployment-grade RL, simulation-to-real thinking, safety/performance tradeoffs, measurable control',
          'Product implication: agent systems get more trustworthy when they close the loop with feedback and evidence',
        ],
      },
      {
        title: 'CMU: Physical AI As An Ecosystem, Not A Demo',
        content:
          'CMU’s 2026 physical AI and robotics coverage shows another pattern worth learning from: the best robotics progress often comes from ecosystems, not isolated demos. CMU frames physical AI as the intersection of autonomy, perception, human-centered deployment, and real test environments. That is a useful product lesson for software teams too. Strong agent systems need infrastructure around the model: workspaces, execution environments, evaluation loops, and domain-specific testing grounds.',
        bulletPoints: [
          'Official source: Carnegie Mellon University, “From Foundational Robotics to Physical AI,” February 13, 2026',
          'Key themes: long-horizon robotics, real-world testing, infrastructure, human-centered deployment',
          'Product implication: build an ecosystem around the agent, not just a single assistant surface',
        ],
      },
      {
        title: 'Translate Robotics Research Into Software-Agent Design',
        content:
          'The point of learning from physical AI is not to pretend every product is a robot. It is to steal the right architecture lessons. Embodied systems force strong habits that software agents also need: explicit planning, feedback loops, environment state, verification, and runtime observability.',
        tableData: {
          headers: ['Robotics Research Pattern', 'Software-Agent Equivalent', 'Why It Transfers'],
          rows: [
            ['Simulation before deployment', 'Sandbox preview / test environment', 'Lets the agent fail safely before touching the real workspace'],
            ['Environment feedback', 'Typecheck, tests, lint, UI preview', 'Turns generation into a closed loop instead of one shot'],
            ['Embodied planning', 'Task plans + tool graphs + sub-agents', 'Improves long-horizon execution'],
            ['Cross-embodiment transfer', 'Cross-workspace reusable skills', 'Lets one learned capability move across contexts'],
            ['Safety layers', 'Approvals, tool gating, verification thresholds', 'Prevents clever failure from looking like success'],
          ],
        },
      },
      {
        title: 'Interactive Example: Use A Robotics Lens On OpenSwan',
        content:
          'This should become a design exercise, not just background reading. The robotics lens is especially useful when you want to harden an agent runtime.',
        codeExample: `Physical-AI prompt drill:
"Review OpenSwan like a robotics system, not a chatbot.
Where does it need:
1. stronger environment sensing,
2. better task planning,
3. safer execution,
4. tighter verification,
5. better recovery after failure?"

Better follow-up:
"Map the missing pieces into runtime upgrades, sandbox features, tool gating, and eval loops."`,
      },
    ],
  },
];

export const WIKI_FUTURE_PATHS: WikiFuturePath[] = [
  {
    id: 'future-builder-city-systems',
    title: 'Design The City That Teaches',
    subtitle: 'Future cities, infrastructure, energy, and public learning as one system.',
    description:
      'Use this path to imagine places where transit, schools, utilities, civic data, and AI helpers make everyday life easier to understand and improve.',
    icon: 'CT',
    color: '#f59e0b',
    articleIds: [
      'future-cities-epcot-systems',
      'infrastructure-public-systems',
      'energy-materials-systems',
      'nikola-tesla-systems-buildout-roadmap',
    ],
    searchQuery: 'future cities infrastructure energy systems',
    outcome: 'Sketch a city system that a student could walk through, question, and improve.',
  },
  {
    id: 'future-builder-human-health',
    title: 'Make Health Knowledge Usable',
    subtitle: 'Medical AI, cancer literacy, trials, prevention, and patient navigation.',
    description:
      'Use this path to turn intimidating health information into calm decision support, better questions, and safer care navigation.',
    icon: 'HX',
    color: '#ef4444',
    articleIds: [
      'health-biotech-knowledge-safety',
      'all-cancers-research-atlas',
      'cancer-screening-prevention-risk-guide',
      'cancer-decision-support-self-advocacy',
    ],
    searchQuery: 'health biotech cancer decision support safety',
    outcome: 'Design a health explainer that helps someone prepare for a real conversation with a clinician.',
  },
  {
    id: 'future-builder-agent-craft',
    title: 'Build Trustworthy Agents',
    subtitle: 'Tools, memory, evals, permission gates, and app automation.',
    description:
      'Use this path to learn how serious agent systems sense the world, ask for permission, use tools, verify work, and recover when plans fail.',
    icon: '>_',
    color: '#22c55e',
    articleIds: [
      'agentic-computer-app-automation-for-agents',
      'agent-tool-contracts-and-evals-for-agents',
      'evals-ai-reliability',
      'ai-safety-permission-patterns',
    ],
    searchQuery: 'agent automation evals safety tools memory',
    outcome: 'Write a reliability checklist for an agent that can operate apps without surprising the user.',
  },
  {
    id: 'future-builder-open-tools',
    title: 'Own The Tools You Learn With',
    subtitle: 'Open models, MCP servers, vector search, and local-first systems.',
    description:
      'Use this path to understand how open infrastructure lets students, builders, and small teams make learning systems they can inspect and extend.',
    icon: '<>',
    color: '#a855f7',
    articleIds: [
      'open-source-model-serving-stack',
      'mcp-overview',
      'mcp-tools-resources-prompts',
      'vector-databases',
    ],
    searchQuery: 'open source mcp vector databases local models',
    outcome: 'Map a personal learning lab that can search its notes, use local tools, and explain its sources.',
  },
  {
    id: 'future-builder-cosmic-curiosity',
    title: 'Stay Curious At Planet Scale',
    subtitle: 'Science, frontier labs, universe maps, robotics, and research translation.',
    description:
      'Use this path to connect wonder with disciplined inquiry, so big questions become experiments, models, and better product judgment.',
    icon: 'SC',
    color: '#a855f7',
    articleIds: [
      'universe-science-field-map',
      'ai-university-research-fronts-2026',
      'frontier-ai-labs-2026',
      'physical-ai-robotics-fronts-2026',
    ],
    searchQuery: 'science universe robotics research fronts',
    outcome: 'Turn one big question into a testable research map with evidence, unknowns, and next experiments.',
  },
];

export const WIKI_RESEARCH_INSIGHTS: WikiResearchInsight[] = [
  {
    id: 'retrieval-practice',
    title: 'Recall Before Rereading',
    sourceLabel: 'Dunlosky et al. / retrieval practice',
    sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/26173288/',
    principle:
      'Learners remember more when they actively retrieve ideas instead of only rereading or highlighting.',
    addToWiki:
      'Add short recall prompts, self-check questions, and answer-later cards to every article.',
    userAction: 'Close the article for one minute, then write the three ideas you can still explain.',
    searchQuery: 'retrieval practice testing effect learning',
    color: '#38bdf8',
  },
  {
    id: 'spaced-return',
    title: 'Come Back On Purpose',
    sourceLabel: 'Dunlosky et al. / distributed practice',
    sourceUrl: 'https://www.aft.org/ae/fall2013/dunlosky',
    principle:
      'Spacing practice over time is one of the highest-utility learning techniques across age groups and materials.',
    addToWiki:
      'Give articles a return plan: today for orientation, tomorrow for recall, next week for transfer.',
    userAction: 'Save one article as a return topic and revisit it after doing something else.',
    searchQuery: 'distributed practice spaced repetition learning',
    color: '#22c55e',
  },
  {
    id: 'transfer-metacognition',
    title: 'Transfer To A New Situation',
    sourceLabel: 'National Academies / How People Learn',
    sourceUrl: 'https://www.nationalacademies.org/read/9853/chapter/6',
    principle:
      'Deep learning shows up when people can extend what they learned into a new context.',
    addToWiki:
      'Attach transfer prompts that ask readers to apply an idea to a classroom, company, city, lab, or app.',
    userAction: 'Name one place where this idea would behave differently, then explain why.',
    searchQuery: 'learning transfer metacognition reflection',
    color: '#f59e0b',
  },
  {
    id: 'project-based-learning',
    title: 'Build A Public Product',
    sourceLabel: 'PBLWorks / Gold Standard PBL',
    sourceUrl: 'https://www.pblworks.org/what-is-pbl/gold-standard-project-design',
    principle:
      'Project-based learning works best around meaningful problems, sustained inquiry, authenticity, reflection, critique, and a public product.',
    addToWiki:
      'Turn article clusters into quests with a question, artifact, critique checklist, and shareable result.',
    userAction: 'Convert the article into a one-afternoon project someone else could inspect.',
    searchQuery: 'project based learning public product sustained inquiry',
    color: '#ec4899',
  },
  {
    id: 'knowledge-building',
    title: 'Improve Ideas Together',
    sourceLabel: 'Scardamalia/Bereiter knowledge building',
    sourceUrl: 'https://www.knowledgebuilders.net/what-is-knowledge-building',
    principle:
      'Knowledge communities treat ideas as improvable public objects, not private notes that stop after first draft.',
    addToWiki:
      'Add idea-improvement prompts: what is promising, what is missing, what evidence would raise the quality?',
    userAction: 'Rewrite one weak idea from the article into a stronger shared explanation.',
    searchQuery: 'knowledge building idea improvement community knowledge',
    color: '#a855f7',
  },
  {
    id: 'futures-literacy',
    title: 'Imagine More Than One Future',
    sourceLabel: 'UNESCO Futures of Education',
    sourceUrl: 'https://www.unesco.org/en/futures-education',
    principle:
      'Future-ready learning should help people imagine multiple futures and act in the present with more agency.',
    addToWiki:
      'Give future-facing articles scenario prompts: hopeful future, brittle future, surprising future, and what to build now.',
    userAction: 'Write two possible futures from this idea, then choose one action that helps the better one happen.',
    searchQuery: 'futures literacy education student agency',
    color: '#14b8a6',
  },
  {
    id: 'faceted-wayfinding',
    title: 'Make Discovery Multi-Dimensional',
    sourceLabel: 'Nielsen Norman Group / facets',
    sourceUrl: 'https://www.nngroup.com/articles/filters-vs-facets/',
    principle:
      'Faceted navigation helps users narrow large content sets through meaningful dimensions instead of relying on search alone.',
    addToWiki:
      'Add filters for topic, domain, skill level, buildable artifact, source type, and future path.',
    userAction: 'Use at least two lenses when browsing: topic plus what you want to make with it.',
    searchQuery: 'faceted navigation information architecture wiki search',
    color: '#84cc16',
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

export function getArticle(id: string): WikiArticle | undefined {
  return WIKI_ARTICLES.find(a => a.id === id);
}

export function getArticlesByCategory(category: WikiCategory): WikiArticle[] {
  return WIKI_ARTICLES.filter(a => a.category === category);
}

export function searchArticles(query: string): WikiArticle[] {
  const q = query.toLowerCase();
  return WIKI_ARTICLES.filter(a =>
    a.title.toLowerCase().includes(q) ||
    a.subtitle.toLowerCase().includes(q) ||
    a.tags.some(t => t.includes(q))
  );
}

export function getCategoryInfo(): WikiCategoryInfo[] {
  return WIKI_CATEGORIES.map(c => ({
    ...c,
    articleCount: WIKI_ARTICLES.filter(a => a.category === c.id).length,
  }));
}

export function getRelatedArticles(articleId: string): WikiArticle[] {
  const article = getArticle(articleId);
  if (!article) return [];
  return WIKI_ARTICLES.filter(a =>
    a.id !== articleId && a.tags.some(t => article.tags.includes(t))
  ).slice(0, 5);
}

export function getWikiFuturePaths(limit = WIKI_FUTURE_PATHS.length): WikiFuturePath[] {
  return WIKI_FUTURE_PATHS
    .filter(path => path.articleIds.some(articleId => Boolean(getArticle(articleId))))
    .slice(0, limit);
}

export function getWikiResearchInsights(limit = WIKI_RESEARCH_INSIGHTS.length): WikiResearchInsight[] {
  return WIKI_RESEARCH_INSIGHTS.slice(0, limit);
}

function insightById(id: string): WikiResearchInsight {
  const insight = WIKI_RESEARCH_INSIGHTS.find(item => item.id === id);
  if (!insight) throw new Error(`Missing wiki research insight: ${id}`);
  return insight;
}

export function getWikiArticleLearningLoop(articleId: string): WikiArticleLearningLoopStep[] {
  const article = getArticle(articleId);
  if (!article) return [];

  const recall = insightById('retrieval-practice');
  const transfer = insightById('transfer-metacognition');
  const project = insightById('project-based-learning');
  const future = insightById('futures-literacy');

  return [
    {
      id: `${article.id}-recall`,
      label: 'Recall',
      title: 'Pull it from memory',
      prompt: `Without looking back, explain the main idea of ${article.title} in three sentences and list two details you almost forgot.`,
      sourceLabel: recall.sourceLabel,
      sourceUrl: recall.sourceUrl,
      searchQuery: recall.searchQuery,
    },
    {
      id: `${article.id}-transfer`,
      label: 'Transfer',
      title: 'Use it somewhere else',
      prompt: `Apply ${article.title} to a different setting: a classroom, city, health system, lab, company, or personal project. What changes?`,
      sourceLabel: transfer.sourceLabel,
      sourceUrl: transfer.sourceUrl,
      searchQuery: transfer.searchQuery,
    },
    {
      id: `${article.id}-project`,
      label: 'Project',
      title: 'Make one inspectable artifact',
      prompt: `Turn ${article.title} into a visible artifact: a map, checklist, prototype, explainer, experiment, or operating guide someone else can critique.`,
      sourceLabel: project.sourceLabel,
      sourceUrl: project.sourceUrl,
      searchQuery: project.searchQuery,
    },
    {
      id: `${article.id}-future`,
      label: 'Future',
      title: 'Compare two futures',
      prompt: `Imagine a hopeful future and a brittle future shaped by ${article.title}. What present-day choice pushes toward the better one?`,
      sourceLabel: future.sourceLabel,
      sourceUrl: future.sourceUrl,
      searchQuery: future.searchQuery,
    },
  ];
}

export function getWikiArticleBuilderPrompts(articleId: string, limit = 3): WikiBuilderPrompt[] {
  const article = getArticle(articleId);
  if (!article) return [];

  const relatedIds = getRelatedArticles(articleId).slice(0, 2).map(item => item.id);
  const primaryIdea = article.content[0]?.title || article.title;
  const articleIds = [article.id, ...relatedIds];

  return [
    {
      id: `${article.id}-imagine`,
      label: 'Imagine',
      title: 'Picture the world after this idea works',
      prompt: `Imagine ${article.title} is normal in everyday life. What becomes easier, safer, more beautiful, or more understandable for a young person growing up with it?`,
      followUp: `Use "${primaryIdea}" as the anchor, then name one risk that still needs adult-level judgment.`,
      articleIds,
      searchQuery: article.tags.slice(0, 4).join(' '),
    },
    {
      id: `${article.id}-build`,
      label: 'Build',
      title: 'Turn the lesson into a small prototype',
      prompt: `Design a small prototype, classroom activity, app feature, or field experiment that teaches the core idea behind ${article.title}.`,
      followUp: 'Keep it small enough to test in one afternoon, and name the evidence that would prove it helped.',
      articleIds,
      searchQuery: `${article.category} prototype ${article.tags[0] || article.title}`,
    },
    {
      id: `${article.id}-question`,
      label: 'Question',
      title: 'Ask the hard question before scaling it',
      prompt: `What should a responsible builder ask before applying ${article.title} to real people, public systems, or shared data?`,
      followUp: 'Separate curiosity, safety, access, incentives, and long-term maintenance.',
      articleIds,
      searchQuery: `${article.title} safety responsibility`,
    },
  ].slice(0, limit);
}

export function getArticlesForLesson(trackId: string, moduleId: string, lessonId: string): WikiArticle[] {
  const lessonRef = `${trackId}:${moduleId}:${lessonId}`;
  return WIKI_ARTICLES.filter(article => article.relatedLessonIds?.includes(lessonRef));
}

export function getPrimaryLessonRefForArticle(articleId: string): { trackId: string; moduleId: string; lessonId: string } | undefined {
  const article = getArticle(articleId);
  const raw = article?.relatedLessonIds?.[0];
  if (!raw) return undefined;
  const [trackId, moduleId, lessonId] = raw.split(':');
  if (!trackId || !moduleId || !lessonId) return undefined;
  return { trackId, moduleId, lessonId };
}

export function getNextWikiArticle(articleId: string): WikiArticle | undefined {
  const currentIndex = WIKI_ARTICLES.findIndex(article => article.id === articleId);
  if (currentIndex === -1) return undefined;

  const related = getRelatedArticles(articleId)[0];
  if (related) return related;

  return WIKI_ARTICLES[currentIndex + 1];
}

function normalizeWikiText(value: string): string {
  return value.toLowerCase();
}

function getArticleSearchHaystack(article: WikiArticle): string {
  const sectionText = article.content.map(section =>
    [
      section.title,
      section.content,
      ...(section.bulletPoints || []),
      section.codeExample || '',
      section.tableData ? `${section.tableData.headers.join(' ')} ${section.tableData.rows.flat().join(' ')}` : '',
    ].join(' ')
  ).join(' ');

  return normalizeWikiText([
    article.title,
    article.subtitle,
    article.category,
    article.tags.join(' '),
    sectionText,
  ].join(' '));
}

function scoreArticleForQuery(article: WikiArticle, query: string): number {
  const q = normalizeWikiText(query).trim();
  if (!q) return 0;

  let score = 0;
  const haystack = getArticleSearchHaystack(article);
  const title = normalizeWikiText(article.title);
  const subtitle = normalizeWikiText(article.subtitle);
  const tags = article.tags.map(normalizeWikiText);
  const category = normalizeWikiText(article.category);
  const terms = q.split(/\s+/).filter(Boolean);

  if (title.includes(q)) score += 16;
  if (subtitle.includes(q)) score += 10;
  if (category.includes(q)) score += 6;
  if (tags.some(tag => tag.includes(q))) score += 12;
  if (haystack.includes(q)) score += 6;

  for (const term of terms) {
    if (title.includes(term)) score += 5;
    if (subtitle.includes(term)) score += 3;
    if (category.includes(term)) score += 2;
    if (tags.some(tag => tag.includes(term))) score += 4;
    if (haystack.includes(term)) score += 1;
  }

  return score;
}

export function getRelevantWikiArticles(query: string, limit = 6): WikiArticle[] {
  const ranked = WIKI_ARTICLES
    .map(article => ({ article, score: scoreArticleForQuery(article, query) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit).map(item => item.article);
}

export function getWikiArticleReferences(query: string, limit = 5): WikiArticleReference[] {
  return getRelevantWikiArticles(query, limit).map(article => ({
    id: article.id,
    title: article.title,
    subtitle: article.subtitle,
    category: article.category,
    color: article.color,
    tags: article.tags,
  }));
}

export function buildWikiKnowledgeBundle(query: string, limit = 6): string {
  const relevant = getRelevantWikiArticles(query, limit);
  const categorySummary = getCategoryInfo()
    .map(category => `${category.title}: ${category.articleCount}`)
    .join(' | ');
  const domainSummary = buildImpactDomainCoverageSummary();
  const domainGuidance = buildImpactDomainGuidance({ query, domainKey: inferImpactDomain({ query }) });

  const intro = `Wiki coverage map: ${categorySummary}. Impact domains: ${domainSummary}.`;

  if (relevant.length === 0) {
    return `${intro}\n${domainGuidance ? `${domainGuidance}\n` : ''}No direct article match found for this query, but the Wiki covers AI, agents, models, frameworks, design, open-source tooling, MCP, future cities, science, infrastructure, health, energy, materials, foundations, and landscape topics.`;
  }

  const articleLines = relevant.map(article => {
    const keySection = article.content[0];
    const bullets = (keySection?.bulletPoints || []).slice(0, 3).join(' | ');
    return [
      `- ${article.title} [${article.category}]`,
      `  Subtitle: ${article.subtitle}`,
      `  Tags: ${article.tags.slice(0, 6).join(', ')}`,
      `  Key point: ${keySection?.content || article.subtitle}`,
      bullets ? `  Highlights: ${bullets}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return `${intro}\n${domainGuidance ? `${domainGuidance}\n` : ''}Relevant wiki articles for "${query}":\n${articleLines}`;
}

function uniqueWikiArticles(articles: WikiArticle[]): WikiArticle[] {
  const seen = new Set<string>();
  const next: WikiArticle[] = [];
  for (const article of articles) {
    if (seen.has(article.id)) continue;
    seen.add(article.id);
    next.push(article);
  }
  return next;
}

function buildSpiritWikiQuery(spiritId?: string | null, query?: string): string {
  if (!spiritId) return query || '';
  const spirit = getSpiritById(spiritId);
  const career = getSpiritCareerProfile(spiritId);
  const operations = getSpiritOperationsProfile(spiritId);
  return [
    query || '',
    spirit?.name || '',
    spirit?.tagline || '',
    spirit?.skillBundle || '',
    career?.seniorRoleTitle || '',
    career?.tags.join(' ') || '',
    career?.ownershipAreas.join(' ') || '',
    operations?.companyFunction || '',
    operations?.mission || '',
    operations?.tags.join(' ') || '',
    operations?.tooling.join(' ') || '',
  ].filter(Boolean).join(' ');
}

export function getRelevantSpiritWikiArticles(
  query: string,
  spiritId?: string | null,
  limit = 6,
): WikiArticle[] {
  const spiritQuery = buildSpiritWikiQuery(spiritId, query).trim();
  const spirit = spiritId ? getSpiritById(spiritId) : null;

  const explicitArticles = spirit
    ? getRelevantWikiArticles(
        [
          spirit.name,
          spirit.tagline,
          spirit.skillBundle,
          ...(spirit.category === 'engineering'
            ? ['coding agents frameworks models mcp evals open source']
            : spirit.category === 'creative'
              ? ['design creativity visual systems multimodal open source']
              : spirit.category === 'leadership'
                ? ['ai landscape strategy product management research']
                : ['ai foundations research interpretability landscape']
          ),
        ].join(' '),
        4,
      )
    : [];

  return uniqueWikiArticles([
    ...getRelevantWikiArticles(spiritQuery || query, limit),
    ...explicitArticles,
  ]).slice(0, limit);
}

export function buildSpiritWikiKnowledgeBundle(
  query: string,
  spiritId?: string | null,
  limit = 6,
): string {
  if (!spiritId) return '';
  const spirit = getSpiritById(spiritId);
  const relevant = getRelevantSpiritWikiArticles(query, spiritId, limit);
  if (relevant.length === 0) return '';

  const intro = spirit
    ? `=== SOUL WIKI INFUSION: ${spirit.name} (${spirit.id}) ===`
    : '=== SOUL WIKI INFUSION ===';

  const lines = relevant.map((article) => {
    const keySection = article.content[0];
    const bullets = (keySection?.bulletPoints || []).slice(0, 3).join(' | ');
    return [
      `- ${article.title} [${article.category}]`,
      `  Subtitle: ${article.subtitle}`,
      `  Tags: ${article.tags.slice(0, 6).join(', ')}`,
      `  Why it matters to this spirit: ${keySection?.content || article.subtitle}`,
      bullets ? `  Highlights: ${bullets}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return `${intro}\n${lines}`;
}

export function buildWikiSearchResponse(query: string, limit = 5): string {
  const relevant = getRelevantWikiArticles(query, limit);

  if (relevant.length === 0) {
    return `**Wiki Search:** No strong match for "${query}".\n\nTry a more specific topic like:\n- future cities\n- EPCOT\n- universe science\n- infrastructure\n- health and biotech\n- energy and materials\n- MCP\n- coding agents\n- model families`;
  }

  const lines = relevant.map((article, index) => {
    const keySection = article.content[0];
    const highlights = (keySection?.bulletPoints || []).slice(0, 2).join(' | ');
    return [
      `${index + 1}. **${article.title}** [${article.category}]`,
      `   ${article.subtitle}`,
      keySection?.content ? `   Key point: ${keySection.content}` : '',
      highlights ? `   Highlights: ${highlights}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return `**Wiki Search: "${query}"**\n\n${lines}`;
}
