/**
 * Plugin Registry — Packaged capability bundles for the agent.
 *
 * A plugin bundles: tools, slash commands, prompts, subagent roles,
 * and approval policies into a named package the user can activate.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface Plugin {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: PluginCategory;

  // What the plugin provides
  slashCommands?: string[];
  systemPromptAddition?: string;
  subagentRoles?: string[];
  connectorRequirements?: string[];   // e.g., 'wordpress', 'github', 'slack'
  approvalDefaults?: Record<string, 'auto' | 'ask'>;

  // Example prompts to show the user
  quickStarts?: Array<{ label: string; prompt: string }>;
}

export type PluginCategory =
  | 'research'
  | 'content'
  | 'engineering'
  | 'design'
  | 'operations'
  | 'growth'
  | 'support'
  | 'community';

// ── Built-in Plugins ────────────────────────────────────────────────────────

export const PLUGINS: Plugin[] = [
  {
    id: 'research-analyst',
    name: 'Research Analyst',
    description: 'Deep research, competitive analysis, market reports',
    icon: 'R',
    color: '#22c55e',
    category: 'research',
    subagentRoles: ['researcher', 'writer'],
    quickStarts: [
      { label: 'Competitive Analysis', prompt: 'Research the competitive landscape for [product/market] and produce a comparison table with recommendations' },
      { label: 'Technology Deep Dive', prompt: 'Do a deep dive on [technology] — architecture, tradeoffs, best practices, and whether we should adopt it' },
      { label: 'Market Research', prompt: 'Research the market for [niche] — size, trends, key players, and opportunities' },
    ],
    systemPromptAddition: 'You have the Research Analyst plugin active. Produce structured research briefs with sources, comparisons, and clear recommendations.',
  },
  {
    id: 'content-studio',
    name: 'Content Studio',
    description: 'Blog posts, social media, newsletters, documentation',
    icon: 'C',
    color: '#ec4899',
    category: 'content',
    subagentRoles: ['writer', 'designer'],
    slashCommands: ['/wp write', '/wp draft', '/wp schedule'],
    connectorRequirements: ['wordpress'],
    quickStarts: [
      { label: 'Blog Post', prompt: 'Write a blog post about [topic] optimized for SEO with a compelling title and meta description' },
      { label: 'Social Thread', prompt: 'Create a Twitter/X thread about [topic] — hook, insights, CTA' },
      { label: 'Newsletter', prompt: 'Draft this week\'s newsletter covering [topics] in a conversational, engaging tone' },
      { label: 'Product Docs', prompt: 'Write documentation for [feature] with examples, API reference, and common use cases' },
    ],
    systemPromptAddition: 'You have the Content Studio plugin active. Produce polished, publication-ready content. If WordPress is connected, you can publish directly via /wp commands.',
  },
  {
    id: 'build-sprint',
    name: 'Build Sprint',
    description: 'Plan, code, review, and ship features',
    icon: 'B',
    color: '#f59e0b',
    category: 'engineering',
    subagentRoles: ['planner', 'coder', 'reviewer'],
    quickStarts: [
      { label: 'Plan Feature', prompt: 'Plan the implementation of [feature] — break it into tasks, identify files to change, and estimate effort' },
      { label: 'Code Review', prompt: 'Review this code for correctness, performance, and style: [paste code]' },
      { label: 'Debug Issue', prompt: 'Help me debug this issue: [describe the problem, error message, what you\'ve tried]' },
      { label: 'Build Component', prompt: 'Build a [component name] React component that [description]' },
    ],
    systemPromptAddition: 'You have the Build Sprint plugin active. Write production-quality code, plan implementations in detail, and review code thoroughly.',
  },
  {
    id: 'design-sprint',
    name: 'Design Sprint',
    description: 'UI/UX design, mockups, design systems, prototypes',
    icon: 'D',
    color: '#a855f7',
    category: 'design',
    subagentRoles: ['designer', 'writer'],
    quickStarts: [
      { label: 'Design Component', prompt: 'Design a [component] with layout, colors, typography, and responsive behavior' },
      { label: 'Landing Page', prompt: 'Design a landing page for [product] — hero, features, pricing, CTA sections' },
      { label: 'Design System', prompt: 'Define a design system for [project] — colors, typography, spacing, components' },
      { label: 'UX Review', prompt: 'Review the UX of [feature/screen] — identify friction, suggest improvements' },
    ],
    systemPromptAddition: 'You have the Design Sprint plugin active. Produce detailed design specs with layout, colors, typography, and code when applicable.',
  },
  {
    id: 'growth-operator',
    name: 'Growth Operator',
    description: 'SEO, analytics, conversion optimization, growth experiments',
    icon: 'G',
    color: '#10b981',
    category: 'growth',
    subagentRoles: ['researcher', 'writer'],
    connectorRequirements: ['google-analytics', 'search_console', 'wordpress'],
    quickStarts: [
      { label: 'SEO Audit', prompt: 'Audit [URL] for SEO — technical issues, content gaps, keyword opportunities' },
      { label: 'Growth Strategy', prompt: 'Create a growth strategy for [product] — channels, experiments, metrics, timeline' },
      { label: 'A/B Test Plan', prompt: 'Design an A/B test for [hypothesis] — variants, metrics, sample size, duration' },
    ],
    systemPromptAddition: 'You have the Growth Operator plugin active. Focus on actionable growth strategies with specific metrics and experiments.',
  },
  {
    id: 'support-triage',
    name: 'Support Triage',
    description: 'Customer support, bug triage, FAQ generation',
    icon: 'S',
    color: '#3b82f6',
    category: 'support',
    subagentRoles: ['support'],
    connectorRequirements: ['slack', 'discord'],
    quickStarts: [
      { label: 'Write FAQ', prompt: 'Generate an FAQ for [product/feature] covering the top 10 questions users ask' },
      { label: 'Triage Bug', prompt: 'Triage this bug report: [description]. Severity? Root cause? Fix?' },
      { label: 'Response Template', prompt: 'Write a support response template for [common issue]' },
    ],
    systemPromptAddition: 'You have the Support Triage plugin active. Be clear, patient, and solution-oriented. Produce ready-to-send responses.',
  },
  {
    id: 'community-manager',
    name: 'Community Manager',
    description: 'Community engagement, event planning, member communications',
    icon: 'M',
    color: '#f472b6',
    category: 'community',
    subagentRoles: ['writer', 'support'],
    connectorRequirements: ['discord', 'slack'],
    quickStarts: [
      { label: 'Community Update', prompt: 'Write a community update post covering [recent developments]' },
      { label: 'Event Plan', prompt: 'Plan a community event: [type] — agenda, logistics, promotion, follow-up' },
      { label: 'Welcome Message', prompt: 'Write a welcome message for new members that explains [community purpose]' },
    ],
    systemPromptAddition: 'You have the Community Manager plugin active. Write warm, engaging community content that drives participation.',
  },
  {
    id: 'executive-briefing',
    name: 'Executive Briefing',
    description: 'Summaries, status reports, decision briefs, meeting prep',
    icon: 'E',
    color: '#6366f1',
    category: 'operations',
    subagentRoles: ['researcher', 'writer'],
    connectorRequirements: ['slack', 'google-analytics', 'hubspot'],
    quickStarts: [
      { label: 'Status Report', prompt: 'Write a status report covering: what was accomplished, what\'s in progress, blockers, and next steps' },
      { label: 'Decision Brief', prompt: 'Write a decision brief for [topic] — options, tradeoffs, data, recommendation' },
      { label: 'Meeting Prep', prompt: 'Prepare for a meeting about [topic] — agenda, talking points, questions to ask, decisions needed' },
    ],
    systemPromptAddition: 'You have the Executive Briefing plugin active. Be concise, data-driven, and decision-oriented. Use tables and bullet points.',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

export function getPlugin(id: string): Plugin | undefined {
  return PLUGINS.find(p => p.id === id);
}

export function getPluginsByCategory(category: PluginCategory): Plugin[] {
  return PLUGINS.filter(p => p.category === category);
}

export function getAllCategories(): { key: PluginCategory; label: string; color: string }[] {
  return [
    { key: 'research', label: 'Research', color: '#22c55e' },
    { key: 'content', label: 'Content', color: '#ec4899' },
    { key: 'engineering', label: 'Engineering', color: '#f59e0b' },
    { key: 'design', label: 'Design', color: '#a855f7' },
    { key: 'operations', label: 'Operations', color: '#6366f1' },
    { key: 'growth', label: 'Growth', color: '#10b981' },
    { key: 'support', label: 'Support', color: '#3b82f6' },
    { key: 'community', label: 'Community', color: '#f472b6' },
  ];
}

/**
 * Build the system prompt addition for active plugins.
 */
export function buildPluginPrompt(activePluginIds: string[]): string {
  const parts: string[] = [];
  for (const id of activePluginIds) {
    const plugin = getPlugin(id);
    if (plugin?.systemPromptAddition) {
      parts.push(plugin.systemPromptAddition);
    }
  }
  return parts.length > 0 ? `## Active Plugins\n${parts.join('\n\n')}` : '';
}

export function getPluginConnectorRequirements(activePluginIds: string[]): string[] {
  return Array.from(new Set(
    activePluginIds.flatMap(id => getPlugin(id)?.connectorRequirements || []),
  ));
}

export function getPluginSubagentRoles(activePluginIds: string[]): string[] {
  return Array.from(new Set(
    activePluginIds.flatMap(id => getPlugin(id)?.subagentRoles || []),
  ));
}
