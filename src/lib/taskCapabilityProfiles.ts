// Task Capability Profiles — define what each task type can do
import { inferImpactDomain, type ImpactDomainKey } from './impactDomains';

export type TaskType = 'code_change' | 'design_work' | 'ui_qa' | 'research' | 'content' | 'ops' | 'room_update' | 'mixed';
export type TaskCapabilityProfileKey =
  | 'research_basic'
  | 'ai_research'
  | 'scientific_research'
  | 'medical_imaging'
  | 'clinical_decision_support'
  | 'materials_research'
  | 'renewable_energy_systems'
  | 'human_flourishing_research'
  | 'ui_design'
  | 'frontend_build'
  | 'browser_qa'
  | 'room_curator';

export interface TaskCapabilityProfile {
  key: TaskCapabilityProfileKey;
  label: string;
  capabilities: string[];
  impactDomain?: ImpactDomainKey;
  defaults: {
    required_artifacts?: string[];
    approval_required?: boolean;
    checks?: string[];
  };
}

export const TASK_CAPABILITY_PROFILES: Record<TaskCapabilityProfileKey, TaskCapabilityProfile> = {
  research_basic: {
    key: 'research_basic', label: 'Research & Analysis',
    capabilities: ['search', 'fetch', 'comment'],
    defaults: { required_artifacts: ['report'], approval_required: false },
  },
  ai_research: {
    key: 'ai_research', label: 'AI Research & Evaluation',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle', 'benchmark_design'],
    defaults: { required_artifacts: ['report', 'citation_bundle'], approval_required: false, checks: ['evidence_review', 'evaluation_review'] },
  },
  scientific_research: {
    key: 'scientific_research', label: 'Scientific Research',
    impactDomain: 'cancer_research',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report', 'citation_bundle'], approval_required: false, checks: ['evidence_review', 'human_review'] },
  },
  medical_imaging: {
    key: 'medical_imaging', label: 'Medical Imaging Analysis Support',
    impactDomain: 'medical_imaging',
    capabilities: ['search', 'fetch', 'classification', 'vision_review', 'comment'],
    defaults: { required_artifacts: ['report'], approval_required: true, checks: ['safety_review', 'human_review'] },
  },
  clinical_decision_support: {
    key: 'clinical_decision_support', label: 'Clinical Decision Support',
    impactDomain: 'clinical_decision_support',
    capabilities: ['search', 'fetch', 'classification', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report', 'citation_bundle'], approval_required: true, checks: ['clinical_review', 'safety_review'] },
  },
  materials_research: {
    key: 'materials_research', label: 'Materials Research',
    impactDomain: 'materials_science',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report'], approval_required: false, checks: ['evidence_review'] },
  },
  renewable_energy_systems: {
    key: 'renewable_energy_systems', label: 'Renewable Energy Systems',
    impactDomain: 'renewable_energy',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report'], approval_required: false, checks: ['system_tradeoff_review'] },
  },
  human_flourishing_research: {
    key: 'human_flourishing_research', label: 'Human Flourishing Research',
    impactDomain: 'human_flourishing',
    capabilities: ['search', 'fetch', 'compare', 'comment', 'citation_bundle'],
    defaults: { required_artifacts: ['report'], approval_required: false, checks: ['impact_review', 'human_review'] },
  },
  ui_design: {
    key: 'ui_design', label: 'UI/UX Design',
    capabilities: ['image_generate', 'figma_inspect', 'visual_artifact'],
    defaults: { required_artifacts: ['image', 'design_spec'], approval_required: false, checks: ['design_handoff', 'human_review'] },
  },
  frontend_build: {
    key: 'frontend_build', label: 'Frontend Build',
    capabilities: ['code_read', 'code_patch', 'static_analysis', 'test_run'],
    defaults: { required_artifacts: ['code_patch'], approval_required: false, checks: ['test_pass', 'human_review'] },
  },
  browser_qa: {
    key: 'browser_qa', label: 'Browser QA',
    capabilities: ['browser_open', 'browser_navigate', 'screenshot_capture'],
    defaults: { required_artifacts: ['screenshot'], approval_required: false, checks: ['browser_check'] },
  },
  room_curator: {
    key: 'room_curator', label: 'Room Curator',
    capabilities: ['room_file_read', 'patch_propose'],
    defaults: { required_artifacts: ['code_patch'], approval_required: true, checks: ['room_patch_review'] },
  },
};

export function getTaskCapabilityProfile(key: string): TaskCapabilityProfile | undefined {
  return TASK_CAPABILITY_PROFILES[key as TaskCapabilityProfileKey];
}

export function inferTaskCapabilityProfile(task: { title: string; description?: string }): TaskCapabilityProfileKey {
  const text = `${task.title} ${task.description || ''}`.toLowerCase();
  const domain = inferImpactDomain(task);
  if (/llm|large language model|agentic ai|multimodal|benchmark|ablation|eval harness|research scientist|model eval|fine[- ]?tuning|inference optimization/i.test(text)) return 'ai_research';
  if (/mri|ct|xray|scan|radiology|imaging|dicom|lesion|segmentation/i.test(text)) return 'medical_imaging';
  if (/disease|diagnos|clinical|physician|doctor|triage|screening|accuracy/i.test(text)) return 'clinical_decision_support';
  if (/cancer|oncology|tumou?r|biomarker|metastasis|tumor/i.test(text)) return 'scientific_research';
  if (/material|materials|battery chemistry|alloy|polymer|catalyst|nanomaterial/i.test(text)) return 'materials_research';
  if (/renewable|solar|wind|grid|energy storage|geothermal|battery storage|power system/i.test(text)) return 'renewable_energy_systems';
  if (/human life|human flourishing|education|public health|culture|global wellbeing|society/i.test(text)) return 'human_flourishing_research';
  if (/mock|redesign|visual|landing|figma|wireframe|ui.*design|design.*comp/i.test(text)) return 'ui_design';
  if (/bug|component|refactor|implement|screen|feature|build|code/i.test(text)) return 'frontend_build';
  if (/test|verify|responsive|regression|qa|browser|screenshot/i.test(text)) return 'browser_qa';
  if (/research|analyze|audit|compare|investigate|explore/i.test(text)) return 'research_basic';
  if (/room|knowledge|doc|organize|curate|wiki/i.test(text)) return 'room_curator';
  if (domain === 'cancer_research') return 'scientific_research';
  if (domain === 'medical_imaging') return 'medical_imaging';
  if (domain === 'clinical_decision_support') return 'clinical_decision_support';
  if (domain === 'materials_science') return 'materials_research';
  if (domain === 'renewable_energy') return 'renewable_energy_systems';
  if (domain === 'human_flourishing') return 'human_flourishing_research';
  return 'research_basic';
}

export function profileRequiresApproval(profileKey: string): boolean {
  const profile = getTaskCapabilityProfile(profileKey);
  return profile?.defaults.approval_required ?? false;
}
