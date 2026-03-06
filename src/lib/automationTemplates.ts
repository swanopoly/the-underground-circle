/**
 * automationTemplates.ts — Pre-built automation templates
 *
 * Users can pick a template to quickly create common automations.
 * Each template pre-fills the creation form.
 */

export interface AutomationTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: 'accountability' | 'reporting' | 'engagement';
  trigger_type: 'schedule' | 'event' | 'manual';
  cron_expression?: string;
  event_config?: { table: string; event: string };
  agent: string;
  model: string;
  output_target: 'activity' | 'chat' | 'webhook' | 'silent';
  prompt: string;
  include_context: Record<string, boolean>;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'daily-standup-summary',
    name: 'Daily Standup Summary',
    icon: '📋',
    description: "Summarize today's check-ins and tasks, highlight who's on track",
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Review today's check-ins and recent task completions for {{circle_name}}. Summarize what each member accomplished, call out who hasn't checked in, and highlight any streaks at risk. Keep it under 200 words. Be direct.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: false },
  },
  {
    id: 'weekly-progress-report',
    name: 'Weekly Progress Report',
    icon: '📊',
    description: 'End-of-week analytics with wins, concerns, and recommendations',
    category: 'reporting',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: 'Generate a weekly progress report for {{circle_name}}. Include: total check-ins this week, tasks completed vs created, streak changes, most active member, MVP nomination. End with one actionable recommendation for next week.',
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true },
  },
  {
    id: 'streak-risk-alert',
    name: 'Streak Risk Alert',
    icon: '🔥',
    description: "Alert when members with 3+ day streaks haven't checked in",
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Check which members of {{circle_name}} have 3+ day streaks but haven't checked in today. For each at-risk member, write a brief personalized nudge. Don't be annoying — be direct and caring. If everyone has checked in, say so briefly.",
    include_context: { members: true, check_ins: true, streaks: true },
  },
  {
    id: 'new-member-welcome',
    name: 'New Member Welcome',
    icon: '👋',
    description: 'Automatically welcome new members with circle context',
    category: 'engagement',
    trigger_type: 'event',
    event_config: { table: 'circle_members', event: 'INSERT' },
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: 'A new member just joined {{circle_name}}. Welcome them warmly. Share: what this circle is about, the top 3 members by streak, and one tip for getting started. Keep it personal and energetic.',
    include_context: { members: true, check_ins: false, tasks: false, streaks: true },
  },
  {
    id: 'checkin-celebration',
    name: 'Check-in Celebration',
    icon: '🎉',
    description: 'Celebrate milestone check-ins (7, 14, 30, 50, 100 days)',
    category: 'engagement',
    trigger_type: 'event',
    event_config: { table: 'check_ins', event: 'INSERT' },
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "A member just checked in. Check their streak data. If their current streak is a milestone (7, 14, 21, 30, 50, 100 days), write a short celebration message with their name. If it's NOT a milestone, respond with just SKIP (the system will ignore it). Event data: {{event}}",
    include_context: { members: true, streaks: true },
  },
  {
    id: 'task-completion-digest',
    name: 'Task Completion Digest',
    icon: '✅',
    description: 'Daily digest of completed tasks with impact summary',
    category: 'reporting',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'activity',
    prompt: "List all tasks completed today in {{circle_name}}. For each, note who completed it. End with the circle's overall open vs done task ratio. If no tasks were completed, say so briefly.",
    include_context: { members: true, tasks: true },
  },
  {
    id: 'monday-motivation',
    name: 'Monday Motivation',
    icon: '💪',
    description: 'Weekly motivational kickoff with last week highlights',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "It's Monday. Write a motivational kickoff for {{circle_name}}. Reference last week's wins (tasks done, streaks maintained). Set the tone for the week. Be real, not generic. Quote a real entrepreneur or builder — not the usual suspects. Keep it under 150 words.",
    include_context: { members: true, tasks: true, streaks: true, analytics: true },
  },
  {
    id: 'inactivity-detector',
    name: 'Inactivity Detector',
    icon: '👀',
    description: 'Flag members inactive for 3+ days',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'activity',
    prompt: "Check {{circle_name}} for members who haven't checked in or completed tasks in 3+ days. List them with their last streak count. Suggest one re-engagement action. If everyone is active, say so briefly.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true },
  },
  {
    id: 'challenge-progress-update',
    name: 'Challenge Progress Update',
    icon: '🏆',
    description: 'Daily leaderboard for active challenges',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: 'Summarize active challenges in {{circle_name}}. Show who is leading and who is falling behind. Add a competitive nudge. Keep it under 150 words.',
    include_context: { members: true, check_ins: true, tasks: true },
  },
  {
    id: 'monthly-retrospective',
    name: 'Monthly Retrospective',
    icon: '📝',
    description: 'End-of-month review with trends and insights',
    category: 'reporting',
    trigger_type: 'schedule',
    cron_expression: 'monthly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: 'Generate a monthly retrospective for {{circle_name}}. Analyze: participation trends, streak patterns, task velocity, most improved member, biggest challenge. Provide 3 data-driven recommendations for next month. Format with headers and bullet points.',
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true },
  },
];

export const TEMPLATE_CATEGORIES = [
  { key: 'accountability' as const, label: 'Accountability', icon: '🎯' },
  { key: 'reporting' as const, label: 'Reporting', icon: '📊' },
  { key: 'engagement' as const, label: 'Engagement', icon: '🎉' },
];
