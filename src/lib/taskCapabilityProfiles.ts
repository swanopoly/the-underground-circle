// Task Capability Profiles — define what each task type can do

export type TaskType = 'code_change' | 'design_work' | 'ui_qa' | 'research' | 'content' | 'ops' | 'room_update' | 'mixed';
export type TaskCapabilityProfileKey = 'research_basic' | 'ui_design' | 'frontend_build' | 'browser_qa' | 'room_curator';

export interface TaskCapabilityProfile {
  key: TaskCapabilityProfileKey;
  label: string;
  capabilities: string[];
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
  if (/mock|redesign|visual|landing|figma|wireframe|ui.*design|design.*comp/i.test(text)) return 'ui_design';
  if (/bug|component|refactor|implement|screen|feature|build|code/i.test(text)) return 'frontend_build';
  if (/test|verify|responsive|regression|qa|browser|screenshot/i.test(text)) return 'browser_qa';
  if (/research|analyze|audit|compare|investigate|explore/i.test(text)) return 'research_basic';
  if (/room|knowledge|doc|organize|curate|wiki/i.test(text)) return 'room_curator';
  return 'research_basic';
}

export function profileRequiresApproval(profileKey: string): boolean {
  const profile = getTaskCapabilityProfile(profileKey);
  return profile?.defaults.approval_required ?? false;
}
