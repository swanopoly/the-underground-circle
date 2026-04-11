/**
 * Mission Templates — pre-built mission structures for common circle types
 * See docs/NEXT_LEVEL_PLAN.md Phase 1.3
 */

export interface MissionTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;        // monospace glyph for icon box
  iconColor: string;
  category: 'dev' | 'content' | 'ops' | 'learning' | 'general';
  defaultTasks: { title: string; agentName?: string }[];
  suggestedDeadlineDays: number; // days from now
}

export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: 'dev-sprint',
    name: 'Dev Sprint',
    description: 'Ship a feature in one week. Plan, build, review, deploy.',
    icon: '>_',
    iconColor: '#22d3ee',
    category: 'dev',
    suggestedDeadlineDays: 7,
    defaultTasks: [
      { title: 'Define scope and acceptance criteria' },
      { title: 'Create feature branch and initial commit' },
      { title: 'Implement core functionality' },
      { title: 'Write tests' },
      { title: 'Code review', agentName: 'BlackSwan' },
      { title: 'Deploy to staging' },
      { title: 'Deploy to production' },
    ],
  },
  {
    id: 'bug-hunt',
    name: 'Bug Hunt',
    description: 'Track down and fix a specific bug. Reproduce, diagnose, patch, verify.',
    icon: '!',
    iconColor: '#ef4444',
    category: 'dev',
    suggestedDeadlineDays: 3,
    defaultTasks: [
      { title: 'Reproduce the bug reliably' },
      { title: 'Identify root cause' },
      { title: 'Write failing test' },
      { title: 'Implement fix' },
      { title: 'Verify fix in staging' },
      { title: 'Deploy fix' },
    ],
  },
  {
    id: 'content-push',
    name: 'Content Push',
    description: 'Research, draft, review, and publish content as a team.',
    icon: 'T',
    iconColor: '#a855f7',
    category: 'content',
    suggestedDeadlineDays: 5,
    defaultTasks: [
      { title: 'Research topic and outline key points', agentName: 'BlackSwan' },
      { title: 'Write first draft' },
      { title: 'Internal review and feedback' },
      { title: 'Final edits' },
      { title: 'Publish' },
      { title: 'Share and promote' },
    ],
  },
  {
    id: 'launch-prep',
    name: 'Launch Prep',
    description: 'Checklist-driven launch preparation. Nothing gets missed.',
    icon: '//',
    iconColor: '#f59e0b',
    category: 'ops',
    suggestedDeadlineDays: 14,
    defaultTasks: [
      { title: 'Feature freeze — no new code' },
      { title: 'Full QA pass on all features' },
      { title: 'Performance testing' },
      { title: 'Security review', agentName: 'BlackSwan' },
      { title: 'Update documentation' },
      { title: 'Prepare launch announcement' },
      { title: 'Set up monitoring and alerts', agentName: 'BlackSwan' },
      { title: 'Deploy to production' },
      { title: 'Post-launch smoke test' },
      { title: 'Announce to users' },
    ],
  },
  {
    id: 'research-deep-dive',
    name: 'Research Deep Dive',
    description: 'Investigate a topic, collect findings, and present conclusions.',
    icon: '?',
    iconColor: '#3b82f6',
    category: 'learning',
    suggestedDeadlineDays: 7,
    defaultTasks: [
      { title: 'Define research questions' },
      { title: 'Gather sources and references', agentName: 'BlackSwan' },
      { title: 'Read and annotate key sources' },
      { title: 'Synthesize findings' },
      { title: 'Write summary document' },
      { title: 'Share with circle for discussion' },
    ],
  },
  {
    id: 'weekly-standup',
    name: 'Weekly Standup',
    description: 'Recurring weekly accountability check. What did you ship? What\'s next?',
    icon: '#',
    iconColor: '#22c55e',
    category: 'general',
    suggestedDeadlineDays: 7,
    defaultTasks: [
      { title: 'Each member posts what they shipped this week' },
      { title: 'Each member posts what they\'re working on next' },
      { title: 'Identify blockers' },
      { title: 'BlackSwan posts weekly summary', agentName: 'BlackSwan' },
    ],
  },
  {
    id: 'design-review',
    name: 'Design Review',
    description: 'Collaborative design feedback cycle. Share, critique, iterate.',
    icon: '[]',
    iconColor: '#ec4899',
    category: 'content',
    suggestedDeadlineDays: 5,
    defaultTasks: [
      { title: 'Share design mockups or prototypes' },
      { title: 'Collect feedback from circle members' },
      { title: 'Prioritize changes' },
      { title: 'Implement revisions' },
      { title: 'Final review and approval' },
    ],
  },
  {
    id: 'onboarding',
    name: 'New Member Onboarding',
    description: 'Get a new team member up to speed. Docs, access, intro calls.',
    icon: '+',
    iconColor: '#14b8a6',
    category: 'ops',
    suggestedDeadlineDays: 5,
    defaultTasks: [
      { title: 'Grant repo access and invite to circle' },
      { title: 'Share key docs and architecture overview' },
      { title: 'Pair programming session on codebase' },
      { title: 'First small PR merged' },
      { title: 'Intro call with all circle members' },
    ],
  },
];

/** Get templates filtered by category */
export function getTemplatesByCategory(category?: string): MissionTemplate[] {
  if (!category || category === 'all') return MISSION_TEMPLATES;
  return MISSION_TEMPLATES.filter(t => t.category === category);
}

/** Get a single template by ID */
export function getTemplate(id: string): MissionTemplate | undefined {
  return MISSION_TEMPLATES.find(t => t.id === id);
}

/** Calculate suggested deadline date from a template */
export function suggestedDeadline(template: MissionTemplate): string {
  const d = new Date();
  d.setDate(d.getDate() + template.suggestedDeadlineDays);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

export const TEMPLATE_CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'dev', label: 'Dev' },
  { key: 'content', label: 'Content' },
  { key: 'ops', label: 'Ops' },
  { key: 'learning', label: 'Learning' },
  { key: 'general', label: 'General' },
] as const;
