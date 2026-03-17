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
  category: 'accountability' | 'reporting' | 'engagement' | 'ops' | 'trading' | 'learning';
  trigger_type: 'schedule' | 'event' | 'manual';
  cron_expression?: string;
  event_config?: { table?: string; event: string; provider?: string };
  agent: string;
  model: string;
  output_target: 'activity' | 'chat' | 'webhook' | 'silent';
  prompt: string;
  include_context: Record<string, boolean>;
  /** Agent Spirit ID to use for this automation (from agentSpirits.ts) */
  spirit?: string;
  /** Show in the Suggested section of the dashboard */
  suggested?: boolean;
  /** Icon background color for the suggested grid card */
  suggestedIconBg?: string;
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
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: false, rooms: true, goals: true },
    spirit: 'pm',
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
    prompt: 'Generate a weekly progress report for {{circle_name}}. Include: total check-ins this week, tasks completed vs created, streak changes, most active member, MVP nomination. Review goal progress and room activity. End with one actionable recommendation for next week.',
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'pm',
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
    spirit: 'coach',
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
    spirit: 'coach',
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
    spirit: 'coach',
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
    prompt: "List all tasks completed today in {{circle_name}}. For each, note who completed it and which room/project it belongs to. End with the circle's overall open vs done task ratio. If no tasks were completed, say so briefly.",
    include_context: { members: true, tasks: true, rooms: true },
    spirit: 'pm',
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
    prompt: "It's Monday. Write a motivational kickoff for {{circle_name}}. Reference last week's wins (tasks done, streaks maintained). Mention active rooms/projects and goal progress. Set the tone for the week. Be real, not generic. Quote a real entrepreneur or builder — not the usual suspects. Keep it under 150 words.",
    include_context: { members: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'coach',
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
    prompt: "Check {{circle_name}} for members who haven't checked in or completed tasks in 3+ days. List them with their last streak count. Check for stuck tasks (in_progress for 3+ days). Suggest one re-engagement action. If everyone is active, say so briefly.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, rooms: true },
    spirit: 'coach',
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
    spirit: 'coach',
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
    prompt: 'Generate a monthly retrospective for {{circle_name}}. Analyze: participation trends, streak patterns, task velocity, most improved member, biggest challenge. Review goal progress and room activity. Provide 3 data-driven recommendations for next month. Format with headers and bullet points.',
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'strategist',
  },
  // ─── New templates ────────────────────────────────────────
  {
    id: 'task-assigned-alert',
    name: 'Task Assigned Alert',
    icon: '📌',
    description: 'Notify when a task is completed with a short summary',
    category: 'engagement',
    trigger_type: 'event',
    event_config: { table: 'tasks', event: 'UPDATE' },
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "A task was just completed in {{circle_name}}. Event data: {{event}}. Write a brief congrats message mentioning who completed it and the task title. Keep it to 1-2 sentences. If the data is unclear, say SKIP.",
    include_context: { members: true, tasks: true },
    spirit: 'pm',
  },
  {
    id: 'daily-goal-tracker',
    name: 'Daily Goal Tracker',
    icon: '🎯',
    description: 'Track progress toward goals with daily check-in analysis',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Analyze today's progress for {{circle_name}}. Review goals: {{goals}}. Look at check-ins for mentions of goals, milestones, or blockers. Identify who is making progress and who might need help. Give 1 specific suggestion per struggling member. Be direct, under 200 words.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, goals: true },
    spirit: 'coach',
  },
  {
    id: 'weekend-recap',
    name: 'Weekend Recap',
    icon: '🎬',
    description: 'Fun weekend summary with stats and highlights',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "It's the weekend! Write a fun recap of {{circle_name}}'s week. Include: MVP (most tasks done or best streak), funniest/most interesting check-in, a random award (e.g. 'Most Likely to Deploy on Friday'), room/project highlights, and a challenge for next week. Keep the tone playful. Under 200 words.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, rooms: true, goals: true },
    spirit: 'writer',
  },
  {
    id: 'cost-alert',
    name: 'AI Cost Alert',
    icon: '💰',
    description: 'Alert when AI agent spending exceeds daily threshold',
    category: 'ops',
    trigger_type: 'schedule',
    cron_expression: 'every_6h',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'activity',
    prompt: "Check AI agent spending for {{circle_name}}. Review token usage and cost data. If total daily cost exceeds $5, flag it with a warning and recommend switching expensive tasks to Haiku. If costs are normal, say SKIP.",
    include_context: { members: true, analytics: true },
    spirit: 'devops',
  },
  {
    id: 'smart-nudge',
    name: 'Smart Nudge',
    icon: '🧠',
    description: 'AI picks the most impactful nudge based on who needs it most',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'twice_daily',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "Analyze {{circle_name}} and identify the ONE member who would benefit most from a nudge right now. Consider: haven't checked in, streak at risk, tasks overdue, stuck tasks, or declining activity. Reference their room/project context. Write a personalized, caring but direct message to that specific person. Use their name. One person only, under 100 words. If everyone is crushing it, give a short group shoutout instead.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, rooms: true, goals: true },
    spirit: 'coach',
  },
  {
    id: 'proactive-checkin',
    name: 'Proactive Check-in',
    icon: '💓',
    description: 'Twice-daily heartbeat that reviews who needs attention and sends personalized nudges',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'twice_daily',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "Run a proactive check-in for {{circle_name}}. Review: 1) Who hasn't checked in today? 2) Who has tasks overdue by 2+ days? Stuck tasks: {{stuck_tasks}}. 3) Who has declining streak momentum? 4) What's the status of active goals? {{goals}} For each person who needs attention, write a brief, personalized nudge (use their name, reference their room/project and specific situation). For members who are on track, give a quick one-line acknowledgment. End with one team-level observation. Be a coach, not a bot. Under 300 words.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'coach',
  },
  // ─── Boss Agent (Jon Snow) Automations ──────────────────────────────────────
  {
    id: 'boss-task-promoter',
    name: 'Boss: Auto-Promote Reviewed Tasks',
    icon: '🐺',
    description: 'Jon Snow checks peer-reviewed tasks every 10 min — auto-promotes to final review when all peers have approved',
    category: 'ops',
    trigger_type: 'schedule',
    cron_expression: '*/10 * * * *',
    agent: 'Jon Snow',
    model: 'claude-haiku',
    output_target: 'activity',
    prompt: "You are Jon Snow, the Boss agent. Check all tasks in 'peer_review' status for {{circle_name}}. For each task, check if all assigned peer reviewers (from the task's goal) have approved. If ALL peers approved, promote the task to 'review' status and post a comment: '[AUTO_PROMOTED] Jon Snow promoted this task after all peer reviewers approved.' If some peers haven't reviewed yet, note which ones are pending. Report what you promoted and what's still waiting. Tasks in peer_review: {{tasks_in_peer_review}}",
    include_context: { tasks: true, rooms: true, goals: true },
    spirit: 'tech-lead',
    suggested: false,
  },
  {
    id: 'boss-task-generator',
    name: 'Boss: Daily Task Generation',
    icon: '🐺',
    description: 'Jon Snow generates tasks daily based on active goals with auto-task settings',
    category: 'ops',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'Jon Snow',
    model: 'claude-sonnet',
    output_target: 'activity',
    prompt: "You are Jon Snow, the Boss agent for {{circle_name}}. Review each active goal that has auto_task_count > 0. For each goal, analyze how many tasks exist vs the target count. If more tasks are needed, generate new task titles and descriptions that advance the goal. Consider the room/project context when generating tasks. Assign them round-robin to the goal's assigned agents. Output as JSON array: [{title, description, priority, assigned_agent_id, goal_id}]. Goals: {{goals}} Recent tasks: {{recent_tasks}} Rooms: {{rooms}}",
    include_context: { tasks: true, members: true, rooms: true, goals: true },
    spirit: 'tech-lead',
    suggested: false,
  },
  {
    id: 'boss-stuck-detector',
    name: 'Boss: Detect Stuck Tasks',
    icon: '🐺',
    description: 'Jon Snow flags tasks stuck in the same status for 24+ hours and escalates via Telegram',
    category: 'ops',
    trigger_type: 'schedule',
    cron_expression: 'every_6h',
    agent: 'Jon Snow',
    model: 'claude-haiku',
    output_target: 'activity',
    prompt: "You are Jon Snow, the Boss agent for {{circle_name}}. Find tasks that have been stuck in 'in_progress', 'peer_review', or 'review' for more than 24 hours. For each stuck task: identify the assignee, which room/project it's in, how long it's been stuck, and suggest an action (reassign, break into subtasks, or escalate). If any task is stuck >48h, flag it as URGENT. Stuck tasks: {{stuck_tasks}} Rooms: {{rooms}}",
    include_context: { tasks: true, members: true, rooms: true, goals: true },
    spirit: 'tech-lead',
    suggested: false,
  },
  {
    id: 'telegram-task-alert',
    name: 'Telegram: Task Review Alert',
    icon: '📱',
    description: 'Send Telegram notification when a task needs your review or gets stuck',
    category: 'ops',
    trigger_type: 'event',
    event_config: { table: 'tasks', event: 'UPDATE' },
    agent: 'System',
    model: 'claude-haiku',
    output_target: 'webhook',
    prompt: "A task status changed in {{circle_name}}. Event data: {{event}}. If the task moved to 'review' or 'approved', send a notification: '📋 [TASK_NAME] is ready for your review.' If the task has been stuck >24h, send: '⚠️ [TASK_NAME] has been stuck for [TIME]. Consider taking action.' If neither condition applies, respond with SKIP.",
    include_context: { tasks: true },
    spirit: 'devops',
    suggested: false,
  },

  // ── Productivity & Growth ──────────────────────────────────────────────────

  {
    id: 'focus-time-guardian',
    name: 'Focus Time Guardian',
    icon: '🧘',
    description: 'Post a daily deep work window reminder and protect focus blocks from distractions',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "It's focus time for {{circle_name}}. Review each member's active tasks and pick the single highest-priority item they should deep work on right now. Consider which room/project they're working in. Post a concise focus block: member name → task → room/project → suggested time block (25m, 50m, or 90m based on complexity). End with a reminder: phones off, notifications silenced. Go.",
    include_context: { members: true, tasks: true, rooms: true, goals: true },
    spirit: 'coach',
  },
  {
    id: 'accountability-partner-match',
    name: 'Accountability Partner Match',
    icon: '🤝',
    description: 'Weekly pairing of members as accountability partners based on shared goals',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "Match members of {{circle_name}} into accountability pairs for this week. Pair people with complementary goals or similar struggles — someone strong in consistency with someone building that habit. Consider who's working in the same rooms/projects. For each pair: explain why they're matched, suggest one thing they should check in on daily, and set a micro-challenge they can do together. Rotate from last week's pairings.",
    include_context: { members: true, check_ins: true, streaks: true, tasks: true, rooms: true, goals: true },
    spirit: 'coach',
  },
  {
    id: 'morning-intentions',
    name: 'Morning Intentions',
    icon: '🌅',
    description: 'Prompt members to set their top 3 intentions for the day each morning',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Good morning {{circle_name}}. Review yesterday's results — who completed their tasks, who fell short. Check goal progress and room activity. Then post a fresh daily intentions prompt. Ask each member to reply with their TOP 3 for today (not 5, not 10 — three). Include a quick energy check: 🔋 How charged are you 1-10? Tailor the tone based on yesterday's momentum — celebratory if the group crushed it, urgent if they slacked.",
    include_context: { members: true, check_ins: true, tasks: true, rooms: true, goals: true },
    spirit: 'coach',
  },
  {
    id: 'evening-reflection',
    name: 'Evening Reflection',
    icon: '🌙',
    description: 'End-of-day reflection prompt with wins, lessons, and tomorrow preview',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "It's reflection time for {{circle_name}}. Review today's task completions, check-ins, and room activity. Post an evening wrap: 🏆 Top win of the day (the single best thing someone accomplished), 📉 Biggest miss (diplomatically — what didn't get done), 💡 Lesson of the day (pattern you noticed), 👀 Tomorrow preview (what's on deck based on goals and stuck tasks). Keep the vibe honest but encouraging.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, rooms: true, goals: true },
    spirit: 'mentor',
  },
  {
    id: 'habit-streak-leaderboard',
    name: 'Habit Streak Leaderboard',
    icon: '🏅',
    description: 'Daily leaderboard ranking members by streak length with trash talk',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Post the daily streak leaderboard for {{circle_name}}. Rank all members by current streak length (longest first). Use medals: 🥇🥈🥉 for top 3. Add light competitive trash talk — hype the leader, call out anyone who just lost their streak (RIP 💀), and give a shoutout to anyone who just hit a milestone (7, 14, 30, 60, 90, 365 days). Keep it fun, not mean.",
    include_context: { members: true, streaks: true },
    spirit: 'coach',
  },
  {
    id: 'weekly-goal-review',
    name: 'Weekly Goal Review',
    icon: '🎯',
    description: 'Score each goal 0-100% and recommend adjustments for the coming week',
    category: 'reporting',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "Run a weekly goal review for {{circle_name}}. Goals: {{goals}}. For each active goal: calculate a completion score (0-100%) based on tasks done vs total, assess momentum (accelerating/steady/stalling/stalled), and recommend ONE specific adjustment for next week. If any goal is >2 weeks old with <20% completion, flag it as at-risk and suggest either breaking it down or pivoting. End with the group's overall goal health score.",
    include_context: { members: true, tasks: true, streaks: true, analytics: true, goals: true },
    spirit: 'pm',
  },
  {
    id: 'procrastination-buster',
    name: 'Procrastination Buster',
    icon: '⚡',
    description: 'Detect tasks that have been sitting untouched and challenge members to start them',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Find tasks in {{circle_name}} that have been in 'todo' or 'backlog' for 3+ days without any activity. Also check for stuck tasks: {{stuck_tasks}}. For each procrastinated task: tag the assignee, note the room/project, estimate how long the task actually takes (be honest — most things take 15-45 min), and issue a direct challenge: 'This takes ~20 min. Can you start it in the next 2 hours? Reply ✅ to commit.' If someone has 3+ stale tasks, call it out as a pattern.",
    include_context: { members: true, tasks: true, rooms: true },
    spirit: 'coach',
  },
  {
    id: 'win-of-the-week',
    name: 'Win of the Week',
    icon: '🏆',
    description: 'Celebrate the biggest individual and team wins from the past week',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "It's Win of the Week time for {{circle_name}}! Review the past 7 days — tasks completed, streaks maintained, goals advanced, check-ins submitted. Award: 🏆 MVP (most impactful contributor), 🔥 Iron Will (longest active streak), 🚀 Momentum Award (biggest week-over-week improvement), 💪 Comeback Award (recovered from a broken streak or setback). Write a 2-sentence hype paragraph for each winner. This should feel like a celebration.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true },
    spirit: 'writer',
  },
  {
    id: 'sunday-planning-session',
    name: 'Sunday Planning Session',
    icon: '📅',
    description: 'Guided weekly planning — review last week, set priorities for the week ahead',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "It's Sunday planning for {{circle_name}}. Goals: {{goals}}. Rooms: {{rooms}}. Run a structured planning session: 1) LAST WEEK SCORECARD — tasks completed/total, streak health, goal progress %. 2) UNFINISHED BUSINESS — list every carry-over task and ask: keep, kill, or delegate? 3) THIS WEEK'S BIG 3 — for each member, suggest 3 high-impact tasks based on their goals and rooms. 4) POTENTIAL BLOCKERS — flag stuck tasks and risks. 5) COMMITMENT — ask each member to reply with their #1 non-negotiable for the week.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'pm',
  },
  {
    id: 'energy-check',
    name: 'Midday Energy Check',
    icon: '🔋',
    description: 'Quick pulse check on the group energy and momentum at midday',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Midday energy check for {{circle_name}}. Look at today's activity so far — who's checked in, who hasn't, tasks moved, messages sent. Give a group energy reading: 🟢 Crushing it / 🟡 Steady / 🟠 Slow start / 🔴 Ghost town. If energy is low, post a specific micro-challenge anyone can do in 5 minutes to build momentum. If energy is high, amplify it with a quick shoutout.",
    include_context: { members: true, check_ins: true, tasks: true },
    spirit: 'coach',
  },
  {
    id: 'skill-share-prompt',
    name: 'Skill Share Prompt',
    icon: '🧠',
    description: 'Weekly prompt for a member to share a skill, tip, or lesson with the group',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "It's skill-share time in {{circle_name}}. Pick a different member each week (rotate through the roster). Based on their recent activity and completed tasks, suggest a topic they could share a 2-minute tip on. Post: '@[member] — you crushed [specific thing] this week. Drop a quick tip for the group: how do you [related skill]?' Also suggest 2 backup topics in case they want to pick a different one.",
    include_context: { members: true, tasks: true, check_ins: true },
    spirit: 'mentor',
  },
  {
    id: 'deadline-countdown',
    name: 'Deadline Countdown',
    icon: '⏰',
    description: 'Alert when tasks or goals are approaching their deadlines',
    category: 'accountability',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Check all tasks and goals in {{circle_name}} that have due dates. Goals: {{goals}}. Flag anything due in the next 48 hours: ⏰ [TASK] due in [TIME] — assigned to [MEMBER] — room: [ROOM] — status: [STATUS]. If something is overdue, flag it as 🚨 OVERDUE. If a task due today hasn't been started, escalate: 'This is due TODAY and still in [status]. What's the plan?' Group by urgency: overdue → due today → due tomorrow.",
    include_context: { members: true, tasks: true, rooms: true, goals: true },
    spirit: 'pm',
  },

  // ─── Dev Workflow (Room-centric) ──────────────────────────────────────────
  {
    id: 'pr-summary',
    name: 'Room: PR Summary',
    icon: '🔀',
    description: 'Summarize new PRs and link them to the Room/project they affect',
    category: 'ops',
    trigger_type: 'event',
    event_config: { provider: 'github', event: 'pull_request_opened' },
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "A new PR was opened for {{circle_name}}. PR data: {{event}}. Rooms: {{rooms}}. Match this PR to the Room it belongs to based on files changed vs room files. Generate: 1) Which Room this PR affects, 2) What changed (2-3 bullets), 3) Risk level (low/medium/high), 4) Which room member should review, 5) Impact on room tasks: {{stuck_tasks}}. Post the summary to the matching room's chat.",
    include_context: { members: true, tasks: true, rooms: true, goals: true },
    spirit: 'sr-engineer',
  },
  {
    id: 'deploy-changelog',
    name: 'Room: Deploy Changelog',
    icon: '🚀',
    description: 'Generate a per-room changelog when code is pushed',
    category: 'reporting',
    trigger_type: 'event',
    event_config: { provider: 'github', event: 'push' },
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "New code was pushed for {{circle_name}}. Push data: {{event}}. Rooms: {{rooms}}. Match the changed files to Rooms and generate a per-room changelog: what shipped, what changed, what's still in progress. Link to room tasks that were completed by this push. If the push is to a non-main branch, note which room's feature branch it is. If not mappable, respond with SKIP.",
    include_context: { members: true, rooms: true, tasks: true },
    spirit: 'writer',
  },
  {
    id: 'ci-failure-analyst',
    name: 'Room: CI Failure Analyst',
    icon: '🔧',
    description: 'Diagnose CI failures and route the fix to the right Room',
    category: 'ops',
    trigger_type: 'event',
    event_config: { provider: 'github', event: 'ci_completed' },
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "A CI workflow completed in {{circle_name}}. Event data: {{event}}. Rooms: {{rooms}}. If it PASSED, respond with SKIP. If it FAILED: 1) Identify which Room's code caused the failure based on changed files, 2) Diagnose root cause, 3) Suggest specific fix (file + code change), 4) Tag the room member who last touched that code, 5) Create or update a room task for the fix. Route this alert to the affected room.",
    include_context: { members: true, rooms: true, tasks: true },
    spirit: 'devops',
  },
  {
    id: 'code-review-reminder',
    name: 'Room: Code Review Reminder',
    icon: '👁️',
    description: 'Nudge room members when their PRs have been waiting too long',
    category: 'ops',
    trigger_type: 'schedule',
    cron_expression: 'twice_daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Check open PRs for {{circle_name}}. Rooms: {{rooms}}. Tasks in review: {{tasks_in_peer_review}}. For each open PR, identify which Room it belongs to and tag that room's members. If a PR has been waiting >24h, escalate to the room: '🚨 [ROOM_NAME] has a PR blocking for [TIME].' Also check room tasks in peer_review status — if both a PR and a task are stuck, flag the connection. If all reviews are done, respond with SKIP.",
    include_context: { members: true, rooms: true, tasks: true },
    spirit: 'tech-lead',
  },
  {
    id: 'room-daily-digest',
    name: 'Room: Daily Dev Digest',
    icon: '📋',
    description: 'Per-room daily digest of commits, tasks moved, files changed, and blockers',
    category: 'reporting',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Generate a daily dev digest for each active Room in {{circle_name}}. Rooms: {{rooms}}. For each room: 1) FILES — what was added/changed today, 2) TASKS — moved forward, stuck, or completed, 3) MESSAGES — key decisions from room chat, 4) BLOCKERS — stuck tasks or open issues. Stuck tasks: {{stuck_tasks}}. End each room's section with a one-line next action. Skip rooms with no activity.",
    include_context: { members: true, rooms: true, tasks: true, goals: true },
    spirit: 'pm',
  },
  {
    id: 'room-task-assigner',
    name: 'Room: Smart Task Assignment',
    icon: '📌',
    description: 'Auto-assign new room tasks to members based on file expertise and workload',
    category: 'ops',
    trigger_type: 'event',
    event_config: { table: 'tasks', event: 'INSERT' },
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'activity',
    prompt: "A new task was created in {{circle_name}}. Event data: {{event}}. Rooms: {{rooms}}. If this task is in a Room, analyze: 1) Which room member has worked on similar files, 2) Current workload — who has the fewest open tasks, 3) Who's been most active in this room recently. Suggest the best assignee with rationale. If the task is already assigned, respond with SKIP.",
    include_context: { members: true, rooms: true, tasks: true },
    spirit: 'tech-lead',
  },

  // ─── Strategic & Growth ────────────────────────────────────────────────────
  {
    id: 'quarterly-okr-check',
    name: 'Quarterly OKR Check',
    icon: '📐',
    description: 'Review progress against quarterly objectives and key results',
    category: 'reporting',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "Run a quarterly OKR check for {{circle_name}}. Goals: {{goals}}. Map each active goal to its key results (tasks). Calculate: % of quarter elapsed vs % of goals completed. For each goal: on-track / at-risk / off-track status, specific blockers, and one recommended action. End with an overall confidence score for hitting quarterly targets. Be honest — sugar-coating helps no one.",
    include_context: { members: true, tasks: true, streaks: true, analytics: true, goals: true, rooms: true },
    spirit: 'strategist',
  },
  {
    id: 'team-health-pulse',
    name: 'Team Health Pulse',
    icon: '❤️',
    description: 'Weekly team health assessment based on activity patterns and engagement signals',
    category: 'reporting',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'activity',
    prompt: "Run a team health assessment for {{circle_name}}. Analyze the past 7 days: check-in consistency, task completion velocity, streak trends, room activity, goal progress. Score each health dimension (1-5): Engagement, Productivity, Consistency, Collaboration, Momentum. Flag any member showing burnout signals (declining activity after high output) or disengagement (activity dropping 3+ consecutive days). Suggest 2 team-level improvements.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'researcher',
  },
  {
    id: 'knowledge-base-builder',
    name: 'Knowledge Base Builder',
    icon: '📚',
    description: 'Extract lessons learned, best practices, and decisions from recent activity into a knowledge base',
    category: 'ops',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'activity',
    prompt: "Scan {{circle_name}}'s past week — check-ins, task descriptions, completed work, room messages, and chat discussions. Extract: 1) DECISIONS MADE — what was decided and why, 2) LESSONS LEARNED — what worked, what didn't, 3) BEST PRACTICES — recurring patterns of success, 4) TRIBAL KNOWLEDGE — anything mentioned that isn't documented elsewhere. Format as a structured knowledge entry that could be added to a wiki.",
    include_context: { members: true, check_ins: true, tasks: true, rooms: true },
    spirit: 'researcher',
  },
  {
    id: 'onboarding-checklist',
    name: 'New Member Onboarding Checklist',
    icon: '📋',
    description: 'Generate a personalized onboarding checklist when a new member joins',
    category: 'engagement',
    trigger_type: 'event',
    event_config: { table: 'circle_members', event: 'INSERT' },
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "A new member just joined {{circle_name}}. Create a personalized onboarding checklist for them: 1) SET UP — connect GitHub, set profile, join chat, 2) EXPLORE — review active goals, browse project rooms, check the leaderboard, 3) FIRST ACTIONS — introduce yourself in chat, pick one task to start, set your first daily check-in, 4) THIS WEEK — active rooms/projects, what the team is working on, who to reach out to for help. Make it actionable with checkboxes. Event: {{event}}",
    include_context: { members: true, tasks: true, streaks: true, rooms: true, goals: true },
    spirit: 'mentor',
  },
  {
    id: 'sprint-retro',
    name: 'Sprint Retrospective',
    icon: '🔄',
    description: 'Run an automated sprint retro analyzing what went well, what didnt, and action items',
    category: 'reporting',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "Run a sprint retrospective for {{circle_name}}. Analyze the past week's data and structure as: ✅ WHAT WENT WELL — top 3 wins with specific data (who did what, which rooms/projects progressed), ❌ WHAT DIDN'T GO WELL — missed targets, broken streaks, stalled tasks, stuck tasks (be honest but not harsh), 🔧 ACTION ITEMS — 3 specific, assignable improvements for next week. End with: 'One thing to start, one thing to stop, one thing to continue.' Base everything on real data, not generic advice.",
    include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'pm',
  },
  {
    id: 'security-audit',
    name: 'Weekly Security Scan',
    icon: '🔒',
    description: 'Review recent changes for security issues, dependency vulnerabilities, and exposed secrets',
    category: 'ops',
    trigger_type: 'schedule',
    cron_expression: 'weekly',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'activity',
    prompt: "Run a weekly security audit for {{circle_name}}. Check: 1) Any new dependencies added this week — known CVEs? 2) Recent code changes touching auth, payments, or data access, 3) Hardcoded secrets, API keys, or tokens in recent commits, 4) RLS policy changes or new database tables without proper access control. Rate overall security posture (A-F) and list top 3 action items by severity.",
    include_context: { members: true, analytics: true },
    spirit: 'security',
  },
  {
    id: 'daily-standup-question',
    name: 'Daily Standup Question',
    icon: '❓',
    description: 'Post a different thought-provoking question each day to spark discussion',
    category: 'engagement',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Post a unique daily question for {{circle_name}} to discuss. Alternate between categories: Monday=productivity, Tuesday=learning, Wednesday=creative, Thursday=team, Friday=fun. Make it specific to their recent work when possible (reference tasks they completed, goals they're working on, or rooms/projects they're in). Keep it to one compelling question that can be answered in 1-2 sentences. End with: 'Reply with your answer below 👇'",
    include_context: { members: true, check_ins: true, tasks: true, rooms: true, goals: true },
    spirit: 'mentor',
  },

  // ─── Trading & Wallet ──────────────────────────────────────────────────────
  {
    id: 'trading-portfolio-monitor',
    name: 'Portfolio Monitor',
    icon: '📊',
    description: 'Monitor connected wallets — flag large swings, new tokens, and risk signals',
    category: 'trading',
    trigger_type: 'schedule',
    cron_expression: 'every_6h',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Monitor Solana wallets for {{circle_name}} members. Connected wallets: {{wallets}}. Recent trades: {{recent_trades}}. For each connected wallet: portfolio value change (vs last check), top tokens by value, tokens with >10% swing, new tokens (airdrops/swaps), risk flags (low liquidity tokens). Format as a clean report. If no wallets connected, remind the circle.",
    include_context: { members: true, analytics: true, trading: true },
    spirit: 'researcher',
  },
  {
    id: 'trading-price-alerts',
    name: 'Price Alert Bot',
    icon: '🚨',
    description: 'Check token watchlists for price targets, stop-losses, and volume spikes',
    category: 'trading',
    trigger_type: 'schedule',
    cron_expression: 'every_6h',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'chat',
    prompt: "Check trading alerts for {{circle_name}}. Active alerts: {{trading_alerts}}. Wallets: {{wallets}}. For each alert: compare current price vs target. If an alert triggers (price crossed target), report it and propose a trade action. Output triggered alerts as chat message AND include a JSON trade action array for any recommended trades: [{\"action_type\": \"swap\", \"output_mint\": \"<mint>\", \"amount_sol\": <number>, \"user_id\": \"<user_id>\", \"reason\": \"Price alert triggered: <details>\"}]. Show: token, current price, target price, action (take profit / cut loss / hold). If no alerts triggered, respond SKIP.",
    include_context: { members: true, trading: true },
    spirit: 'researcher',
  },
  {
    id: 'trading-daily-pnl',
    name: 'Daily P&L Report',
    icon: '💰',
    description: 'Daily profit/loss report across all member wallets with leaderboard',
    category: 'trading',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "Generate daily P&L for {{circle_name}} traders. Wallets: {{wallets}}. Recent trades: {{recent_trades}}. Per member: portfolio value change, realized P&L (from swaps), unrealized P&L (open positions), best/worst trade, fees paid. Circle leaderboard by daily P&L. Risk flags for >50% concentration. Use 🟢 for gains, 🔴 for losses.",
    include_context: { members: true, analytics: true, trading: true },
    spirit: 'pm',
  },
  {
    id: 'trading-whale-tracker',
    name: 'Whale Tracker',
    icon: '🐋',
    description: 'Track large wallet movements on tokens your circle holds',
    category: 'trading',
    trigger_type: 'schedule',
    cron_expression: 'every_6h',
    agent: 'BlackSwan',
    model: 'claude-sonnet',
    output_target: 'chat',
    prompt: "Track whale activity for {{circle_name}}'s held tokens. Wallets: {{wallets}}. Monitor large transfers (>$100k), DEX swaps, and liquidity changes on tokens the circle holds. For each whale move: wallet (shortened), action (buy/sell/add liquidity), amount, impact on price. Alert if a whale is accumulating or dumping a token the circle holds. If no activity, SKIP.",
    include_context: { members: true, trading: true },
    spirit: 'researcher',
  },
  {
    id: 'trading-dca-executor',
    name: 'DCA Bot',
    icon: '🤖',
    description: 'Auto dollar-cost average into target tokens on a schedule',
    category: 'trading',
    trigger_type: 'schedule',
    cron_expression: 'daily',
    agent: 'BlackSwan',
    model: 'claude-haiku',
    output_target: 'activity',
    prompt: "Check DCA configs for {{circle_name}} members and propose swaps that are due. DCA configs: {{dca_configs}}. Wallets: {{wallets}}. Recent trades: {{recent_trades}}. For each active DCA config: check if interval has elapsed since last execution, check if max_price limit allows it. If a DCA buy is due, output it as a JSON array of trade actions. Each action: {\"action_type\": \"dca_buy\", \"output_mint\": \"<token_mint>\", \"amount_sol\": <number>, \"user_id\": \"<user_id>\", \"reason\": \"<why>\"}. If balance too low or above price limit, include with reason and amount_sol: 0. If no DCA is due, respond SKIP.",
    include_context: { members: true, trading: true },
    spirit: 'devops',
  },
];

export const TEMPLATE_CATEGORIES = [
  { key: 'accountability' as const, label: 'Accountability', icon: '🎯' },
  { key: 'reporting' as const, label: 'Reporting', icon: '📊' },
  { key: 'engagement' as const, label: 'Engagement', icon: '🎉' },
  { key: 'ops' as const, label: 'Operations', icon: '⚙️' },
  { key: 'trading' as const, label: 'Trading', icon: '📈' },
];

// ─── Suggested Template Groups ──────────────────────────────────────────────

export interface SuggestedGroup {
  key: string;
  label: string;
  icon: string;
  templates: AutomationTemplate[];
}

export const SUGGESTED_GROUPS: SuggestedGroup[] = [
  // ── Meta / System Health ───────────────────────────────────────────────────
  {
    key: 'meta',
    label: 'System Health',
    icon: '>_',
    templates: [
      {
        id: 'suggest-automation-health-report',
        name: 'Automation health report',
        icon: '📡',
        description: 'Audit all automations — success rates, failures, costs, stale configs — and generate a report',
        category: 'ops',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Run a full health audit of all automations in {{circle_name}}. For each automation, report:
1. **Status**: enabled/disabled, last run time, next scheduled run
2. **Reliability**: success rate (%), total runs, consecutive failures
3. **Cost**: total spend this week, avg cost per run, model used
4. **Effectiveness**: is the output being seen? (chat vs activity vs silent)
5. **Issues**: flag any automation that: hasn't run in 7+ days despite being enabled, has <50% success rate, costs >$1/week on Haiku or >$5/week on Sonnet, has error messages in recent runs, or has a stale/generic prompt

Then give an overall AUTOMATION HEALTH SCORE (A/B/C/D/F) with:
- Total automations: X enabled, Y disabled
- Weekly cost: $X.XX
- Reliability: X% average success rate
- Top performer (highest success rate + most runs)
- Most problematic (lowest success rate or most errors)
- Recommendations: 3 specific actions to improve the automation suite

Format as a clean report with headers and bullet points.`,
        include_context: { members: true, analytics: true, rooms: true },
    spirit: 'devops',
        suggested: true,
        suggestedIconBg: '#0d1a1a',
      },
      {
        id: 'suggest-llm-benchmark-tracker',
        name: 'LLM benchmark tracker',
        icon: '📊',
        description: 'Monitor new LLM releases and update the benchmark comparison page with latest scores',
        category: 'ops',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `You are the LLM Benchmark Tracker for {{circle_name}}. Your job is to monitor the AI model landscape and report notable changes.

Check for new model releases and benchmark updates from the past week. Sources to reference:
- OpenAI (GPT-5.x series), Anthropic (Claude 4.x), Google (Gemini 3.x), Alibaba (Qwen3.5), Meta (Llama 4), xAI (Grok), DeepSeek
- HuggingFace Open LLM Leaderboard, lmsys Chatbot Arena, Artificial Analysis

Report the following:

## NEW RELEASES
List any new model releases or major updates from the past week with:
- Model name, provider, parameter count
- Key benchmark scores if available (MMLU, HumanEval, GSM8K, HellaSwag, ARC-C)
- How it compares to existing models in our tracker

## BENCHMARK UPDATES
Any significant score revisions or new benchmark results for existing models.

## BLACKSWAN IMPACT
- How do new releases affect BlackSwan's relative position?
- Any new open-weight models that could be good base models for future BlackSwan training?
- Specific scores to update in the LLM Bench panel (provide model name + benchmark + new score)

## RECOMMENDED ACTIONS
- Models to add to the benchmark panel
- Scores to update
- Whether BlackSwan's training strategy should adapt (e.g. newer base model available)

If nothing notable happened this week, respond with: "No significant LLM releases or benchmark changes this week. Current rankings hold."`,
        include_context: { analytics: true },
    spirit: 'researcher',
        suggested: true,
        suggestedIconBg: '#1a0d2a',
      },
      {
        id: 'suggest-cost-watchdog',
        name: 'AI cost watchdog',
        icon: '💸',
        description: 'Monitor total AI spending across all automations and agents, alert on anomalies',
        category: 'ops',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "Analyze AI spending for {{circle_name}} over the last 24 hours. Check: total tokens used, total cost, cost by model tier (Haiku vs Sonnet vs Opus), cost per automation, and any single run that cost >$0.50. If daily spend exceeds $5 or is 2x higher than the 7-day average, post a warning with the top 3 cost drivers and suggest optimizations (switch to Haiku, reduce frequency, etc.). If costs are normal, respond with SKIP.",
        include_context: { analytics: true },
    spirit: 'devops',
        suggested: true,
        suggestedIconBg: '#2a1a0a',
      },
    ],
  },

  // ── Dev Workflow (Room-centric) ──────────────────────────────────────────
  {
    key: 'dev',
    label: 'Dev Rooms',
    icon: '{}',
    templates: [
      {
        id: 'suggest-room-security-scan',
        name: 'Room security scan',
        icon: '🛡️',
        description: 'Scan a Room\'s files for vulnerabilities — SQL injection, XSS, exposed secrets',
        category: 'ops',
        trigger_type: 'manual',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Scan all project Rooms in {{circle_name}} for security vulnerabilities. Review the actual file contents in each room for: SQL injection, XSS, auth bypasses, exposed secrets, unsafe dependencies, insecure direct object references. Group findings by room. For each issue: file, line range, severity (critical/high/medium), and recommended fix with corrected code. If fixes are needed, use FILE_ACTIONS to write the fixed files back to the room. If a room is clean, say so briefly.",
        include_context: { members: true, rooms: true, tasks: true },
    spirit: 'security',
        suggested: true,
        suggestedIconBg: '#0d2a1a',
      },
      {
        id: 'suggest-room-pr-reviewers',
        name: 'Room PR reviewers',
        icon: '🔀',
        description: 'Assign PR reviewers based on which Room owns the changed files',
        category: 'ops',
        trigger_type: 'manual',
        event_config: { provider: 'github', event: 'pull_request_opened' },
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "A PR was opened in {{circle_name}}. PR: {{event}}. Rooms: {{rooms}}. Match changed files to Rooms. For each affected room, recommend the room member who has the most expertise on those files. If the PR spans multiple rooms, assign a lead reviewer per room. Low-risk changes (docs, tests, config): auto-approve candidate. Post reviewer assignments to each room.",
        include_context: { members: true, rooms: true, tasks: true },
    spirit: 'tech-lead',
        suggested: true,
        suggestedIconBg: '#0d1a2a',
      },
      {
        id: 'suggest-room-ci-fixer',
        name: 'Room CI fixer',
        icon: '⚙️',
        description: 'Route CI failures to the Room that owns the broken code',
        category: 'ops',
        trigger_type: 'manual',
        event_config: { provider: 'github', event: 'ci_completed' },
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "CI completed for {{circle_name}}. Data: {{event}}. Rooms: {{rooms}}. If passed, SKIP. If failed: 1) Which Room's files caused the failure, 2) Root cause analysis, 3) Exact fix (file + code change), 4) Tag the room member who should fix it, 5) Suggest creating a room task for the fix if it's non-trivial. Route the alert to the affected room.",
        include_context: { members: true, rooms: true, tasks: true },
    spirit: 'devops',
        suggested: true,
        suggestedIconBg: '#0d1a2a',
      },
      {
        id: 'suggest-room-bug-finder',
        name: 'Room bug finder',
        icon: '🐛',
        description: 'Scan each Room\'s codebase for critical bugs and auto-fix them',
        category: 'ops',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Scan each active Room in {{circle_name}} for critical bugs. Read the actual file contents and check for: null pointer dereferences, off-by-one errors, race conditions, incorrect error handling, data loss risks. Group findings by room with severity. For critical bugs, use FILE_ACTIONS to write the fixed files directly. For high bugs, describe the fix. Only report high/critical.",
        include_context: { members: true, rooms: true, tasks: true },
    spirit: 'security',
        suggested: true,
        suggestedIconBg: '#2a1a0d',
      },
      {
        id: 'suggest-room-test-coverage',
        name: 'Room test coverage',
        icon: '🧪',
        description: 'Per-room test gap analysis — find untested code and auto-write tests',
        category: 'ops',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Analyze test coverage per Room in {{circle_name}}. Read the actual file contents and identify functions/components with high complexity and no tests. Write test files for the top 3 gaps per room. Prioritize: auth flows, data mutations, critical business logic. Use FILE_ACTIONS to create the test files directly in each room (e.g., create \"Button.test.tsx\" alongside \"Button.tsx\").",
        include_context: { members: true, rooms: true, tasks: true },
    spirit: 'sr-engineer',
        suggested: true,
        suggestedIconBg: '#0d2a0d',
      },
      {
        id: 'suggest-room-docs',
        name: 'Room documentation',
        icon: '📄',
        description: 'Auto-generate docs per Room — README, API refs, architecture notes',
        category: 'ops',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Generate documentation per Room in {{circle_name}}. Read the actual file contents and identify: undocumented exports, missing JSDoc, complex functions without comments. For each room, use FILE_ACTIONS to create or update a README.md file containing: project overview, file structure, key exports, setup instructions, and architecture notes. Also generate inline docs for the most complex files.",
        include_context: { members: true, rooms: true, tasks: true },
    spirit: 'writer',
        suggested: true,
        suggestedIconBg: '#1a1a2a',
      },
      {
        id: 'suggest-room-refactor',
        name: 'Room code refactor',
        icon: '♻️',
        description: 'Analyze and refactor Room files — reduce duplication, improve patterns',
        category: 'ops',
        trigger_type: 'manual',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Analyze the code in each Room of {{circle_name}} for refactoring opportunities. Read the actual file contents and identify: duplicated logic across files, overly complex functions (>50 lines), inconsistent patterns, unused variables/imports, missing error handling. For the top 3 improvements per room, use FILE_ACTIONS to write the refactored files directly. Explain each change briefly. Focus on readability and maintainability, not style.",
        include_context: { members: true, rooms: true, tasks: true },
    spirit: 'sr-engineer',
        suggested: true,
        suggestedIconBg: '#1a0d2a',
      },
      {
        id: 'suggest-room-code-review',
        name: 'Room code review',
        icon: '👁️',
        description: 'AI code review of recently changed files — catches bugs before they ship',
        category: 'ops',
        trigger_type: 'manual',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Review the code in each Room of {{circle_name}}. Read all file contents carefully. For each file, evaluate: correctness (logic bugs, edge cases), security (injection, auth bypass), performance (N+1 queries, unnecessary re-renders), and maintainability. For any issues found, provide the exact fix. For critical issues, use FILE_ACTIONS to apply the fix directly. Format like a PR review with file-level comments.",
        include_context: { members: true, rooms: true, tasks: true },
    spirit: 'tech-lead',
        suggested: true,
        suggestedIconBg: '#0d2a1a',
      },
    ],
  },

  // ── Accountability & Growth ────────────────────────────────────────────────
  {
    key: 'accountability',
    label: 'Accountability',
    icon: '///',
    templates: [
      {
        id: 'suggest-morning-standup',
        name: 'Morning standup',
        icon: '🌅',
        description: 'Kick off each day with intentions, energy check, and yesterday\'s review',
        category: 'accountability',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "Good morning {{circle_name}}. Review yesterday's results — who completed their tasks, who fell short. Check goal and room progress. Post a daily intentions prompt asking each member for their TOP 3 today and a quick energy check (🔋 1-10). Tailor the tone based on yesterday's momentum.",
        include_context: { members: true, check_ins: true, tasks: true, rooms: true, goals: true },
    spirit: 'coach',
        suggested: true,
        suggestedIconBg: '#1a200d',
      },
      {
        id: 'suggest-procrastination-buster',
        name: 'Bust procrastination',
        icon: '⚡',
        description: 'Find stale tasks, estimate real time to complete, and challenge members to start',
        category: 'accountability',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "Find tasks in {{circle_name}} sitting in 'todo' or 'backlog' for 3+ days. Check stuck tasks too. For each: tag the assignee, note the room/project, estimate real time (most things take 15-45 min), issue a challenge: 'Can you start this in the next 2 hours? Reply ✅ to commit.' Flag patterns of 3+ stale tasks.",
        include_context: { members: true, tasks: true, rooms: true },
    spirit: 'coach',
        suggested: true,
        suggestedIconBg: '#2a1a00',
      },
      {
        id: 'suggest-streak-leaderboard',
        name: 'Streak leaderboard',
        icon: '🔥',
        description: 'Daily streak rankings with medals, milestones, and friendly competition',
        category: 'engagement',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "Post the daily streak leaderboard for {{circle_name}}. Rank all members by streak length. 🥇🥈🥉 for top 3. Call out broken streaks (RIP 💀), celebrate milestones (7, 14, 30, 60, 90 days), and hype the leader. Keep it fun and competitive.",
        include_context: { members: true, streaks: true },
    spirit: 'coach',
        suggested: true,
        suggestedIconBg: '#2a150d',
      },
      {
        id: 'suggest-sunday-planning',
        name: 'Sunday planning session',
        icon: '📅',
        description: 'Guided weekly planning with scorecard, carryovers, Big 3, and blockers',
        category: 'accountability',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Run Sunday planning for {{circle_name}}. Goals: {{goals}}. Rooms: {{rooms}}. 1) SCORECARD — tasks completed/total, streak health, goal %. 2) UNFINISHED — carryover tasks: keep, kill, or delegate? 3) BIG 3 — suggest each member's top 3 tasks based on goals and rooms. 4) BLOCKERS — flag stuck tasks and risks. 5) Ask each member for their #1 non-negotiable.",
        include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'pm',
        suggested: true,
        suggestedIconBg: '#0d1a20',
      },
    ],
  },

  // ── Engagement & Culture ───────────────────────────────────────────────────
  {
    key: 'engagement',
    label: 'Engagement',
    icon: '***',
    templates: [
      {
        id: 'suggest-win-of-the-week',
        name: 'Win of the week',
        icon: '🏆',
        description: 'Celebrate MVPs, streaks, comebacks, and biggest improvements weekly',
        category: 'engagement',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Review the past 7 days for {{circle_name}}. Award: 🏆 MVP, 🔥 Iron Will (longest streak), 🚀 Momentum (biggest improvement), 💪 Comeback (recovered from setback). Reference rooms/projects and goal progress. Write hype paragraphs for each winner. Make it feel like a celebration.",
        include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'writer',
        suggested: true,
        suggestedIconBg: '#1a0d20',
      },
      {
        id: 'suggest-new-member-onboarding',
        name: 'Auto-welcome new members',
        icon: '👋',
        description: 'Welcome new members with circle context, top streaks, and tips for getting started',
        category: 'engagement',
        trigger_type: 'event',
        event_config: { table: 'circle_members', event: 'INSERT' },
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: 'A new member joined {{circle_name}}. Welcome them warmly. Share: what this circle is about, top 3 members by streak, and one tip for getting started. Keep it personal. Event: {{event}}',
        include_context: { members: true, streaks: true },
    spirit: 'coach',
        suggested: true,
        suggestedIconBg: '#0d201a',
      },
      {
        id: 'suggest-midday-pulse',
        name: 'Midday energy pulse',
        icon: '🔋',
        description: 'Quick pulse check on group energy and momentum with micro-challenges',
        category: 'engagement',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "Midday energy check for {{circle_name}}. Check today's activity — who's checked in, tasks moved, messages sent. Give a reading: 🟢 Crushing it / 🟡 Steady / 🟠 Slow / 🔴 Ghost town. If low, post a 5-minute micro-challenge. If high, amplify with a shoutout.",
        include_context: { members: true, check_ins: true, tasks: true },
    spirit: 'coach',
        suggested: true,
        suggestedIconBg: '#1a1a0d',
      },
      {
        id: 'suggest-skill-share',
        name: 'Weekly skill share',
        icon: '🧠',
        description: 'Prompt a different member each week to share a tip based on their recent work',
        category: 'engagement',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "Skill-share time in {{circle_name}}. Pick a different member each week. Based on their recent tasks, suggest a topic: '@[member] — you crushed [thing]. Drop a quick tip for the group: how do you [skill]?' Suggest 2 backup topics.",
        include_context: { members: true, tasks: true, check_ins: true },
    spirit: 'mentor',
        suggested: true,
        suggestedIconBg: '#1a0d1a',
      },
    ],
  },

  // ── Reporting & Analytics ──────────────────────────────────────────────────
  {
    key: 'reporting',
    label: 'Reporting',
    icon: '|||',
    templates: [
      {
        id: 'suggest-summarize-changes-daily',
        name: 'Daily changelog',
        icon: '📧',
        description: 'Daily digest of repository changes, risks, and open PRs',
        category: 'reporting',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "Generate a daily changelog digest for {{circle_name}}. Summarize yesterday's commits: what shipped, what changed, any risky changes, open PRs needing review. Include room/project context. Flag anything that could break prod. Keep it under 250 words.",
        include_context: { members: true, tasks: true, analytics: true, rooms: true },
    spirit: 'sr-engineer',
        suggested: true,
        suggestedIconBg: '#000000',
      },
      {
        id: 'suggest-weekly-progress',
        name: 'Weekly progress report',
        icon: '📊',
        description: 'End-of-week analytics with wins, concerns, MVP nomination, and recommendations',
        category: 'reporting',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: 'Weekly report for {{circle_name}}: total check-ins, tasks completed vs created, streak changes, goal progress, room activity, most active member, MVP nomination, and one actionable recommendation for next week.',
        include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'pm',
        suggested: true,
        suggestedIconBg: '#0d1a1a',
      },
      {
        id: 'suggest-monthly-retro',
        name: 'Monthly retrospective',
        icon: '📝',
        description: 'Deep monthly analysis with trends, most improved member, and data-driven recommendations',
        category: 'reporting',
        trigger_type: 'schedule',
        cron_expression: 'monthly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: 'Monthly retro for {{circle_name}}. Analyze: participation trends, streak patterns, task velocity, goal progress, room activity, most improved member, biggest challenge. Provide 3 data-driven recommendations for next month. Format with headers and bullets.',
        include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true, rooms: true, goals: true },
    spirit: 'strategist',
        suggested: true,
        suggestedIconBg: '#1a0d1a',
      },
      {
        id: 'suggest-goal-health-check',
        name: 'Goal health check',
        icon: '🎯',
        description: 'Score each goal 0-100%, assess momentum, and flag at-risk goals',
        category: 'reporting',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: "Goal review for {{circle_name}}. Goals: {{goals}}. Rooms: {{rooms}}. For each active goal: completion score (0-100%), momentum (accelerating/steady/stalling), one adjustment for next week. Flag goals >2 weeks old with <20% completion. End with overall goal health score.",
        include_context: { members: true, tasks: true, streaks: true, analytics: true, goals: true, rooms: true },
    spirit: 'pm',
        suggested: true,
        suggestedIconBg: '#0d200d',
      },
    ],
  },

  // ── Integrations ──────────────────────────────────────────────────────────
  {
    key: 'integrations',
    label: 'Integrations',
    icon: '</>',
    templates: [
      {
        id: 'suggest-fix-bugs-in-slack',
        name: 'Fix bugs from Slack',
        icon: '🔧',
        description: 'Investigate reported bugs and propose fixes',
        category: 'ops',
        trigger_type: 'manual',
        event_config: { provider: 'slack', event: 'message' },
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: 'A message was posted in the bug-reports Slack channel for {{circle_name}}. Message: {{event}}. If this is a bug report, analyze the error, investigate likely root causes, and propose a fix with specific file + line changes. If not a bug report, respond with SKIP.',
        include_context: { members: true },
    spirit: 'devops',
        suggested: true,
        suggestedIconBg: '#1a0d2a',
      },
      {
        id: 'suggest-triage-linear',
        name: 'Triage Linear issues',
        icon: '🎟️',
        description: 'Classify, prioritize, and assign issues',
        category: 'ops',
        trigger_type: 'manual',
        event_config: { provider: 'linear', event: 'issue_created' },
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: 'New Linear issue for {{circle_name}}: {{event}}. Triage: 1) Classify (bug/feature/chore) 2) Estimate (S/M/L/XL) 3) Priority (urgent/high/medium/low) 4) If small bug, write the fix 5) Assign to most relevant member.',
        include_context: { members: true },
    spirit: 'pm',
        suggested: true,
        suggestedIconBg: '#0d0d2a',
      },
      {
        id: 'suggest-investigate-pagerduty',
        name: 'Investigate incidents',
        icon: '🔍',
        description: 'Rapid root cause analysis for production incidents',
        category: 'ops',
        trigger_type: 'manual',
        event_config: { provider: 'slack', event: 'message' },
        agent: 'BlackSwan',
        model: 'claude-opus',
        output_target: 'chat',
        prompt: 'Incident triggered for {{circle_name}}: {{event}}. Rapid RCA: affected service, likely causes from recent deploys, immediate mitigation, long-term fix. Structured report, under 300 words.',
        include_context: { members: true, analytics: true },
    spirit: 'devops',
        suggested: true,
        suggestedIconBg: '#2a0d1a',
      },
      {
        id: 'suggest-clean-feature-flags',
        name: 'Clean up feature flags',
        icon: '🚩',
        description: 'Find stale feature flags fully rolled out and suggest cleanup',
        category: 'ops',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: "Find stale feature flags in {{circle_name}}: enabled 100%, older than 30 days, or never referenced. For each, suggest exact cleanup. Output as checklist.",
        include_context: { members: true },
    spirit: 'devops',
        suggested: true,
        suggestedIconBg: '#2a0d0d',
      },
    ],
  },

  // ── Trading & Wallet ───────────────────────────────────────────────────
  {
    key: 'trading',
    label: 'Trading',
    icon: '◎',
    templates: [
      {
        id: 'suggest-portfolio-watchdog',
        name: 'Portfolio watchdog',
        icon: '📊',
        description: 'Monitor wallet balances, flag large swings, and alert on significant changes',
        category: 'trading',
        trigger_type: 'schedule',
        cron_expression: 'every_6h',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: `Monitor connected wallets for {{circle_name}} members. For each member with a connected Solana wallet, check:
1. **Portfolio value** — current total vs last snapshot. Flag any change >5% in 24h
2. **Token holdings** — list top tokens by value, highlight any token with >20% price swing
3. **New tokens** — flag any tokens that appeared (possible airdrops or swaps)
4. **Risk alerts** — any token with <$10k liquidity, rug-pull indicators, or suspicious activity
5. **Gas spent** — total SOL spent on transaction fees today

Format as a clean portfolio report per member. If no wallets connected, remind the circle to connect their wallets in the Wallet tab.`,
        include_context: { members: true, analytics: true, trading: true },
    spirit: 'researcher',
        suggested: true,
        suggestedIconBg: '#1a0d2a',
      },
      {
        id: 'suggest-token-scanner',
        name: 'Token scanner',
        icon: '🔍',
        description: 'Scan for trending tokens, new launches, and trading opportunities on Solana',
        category: 'trading',
        trigger_type: 'schedule',
        cron_expression: 'every_6h',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Scan the Solana ecosystem for {{circle_name}}'s trading bot. Report:
1. **Trending tokens** — top 5 tokens by volume increase in the last 6h
2. **New launches** — tokens launched in the last 24h with >$50k liquidity
3. **Whale movements** — large transfers (>$100k) on tokens the circle's wallets hold
4. **DeFi opportunities** — staking APY changes, new liquidity pools, yield farming
5. **Risk flags** — tokens in the watchlist with declining liquidity or dev wallet dumps

For each opportunity, include: token name, contract address, current price, 24h volume, liquidity, and a risk score (1-10). Only surface actionable intel.`,
        include_context: { members: true, analytics: true, trading: true },
    spirit: 'researcher',
        suggested: true,
        suggestedIconBg: '#0d1a2a',
      },
      {
        id: 'suggest-dca-executor',
        name: 'DCA bot',
        icon: '🤖',
        description: 'Dollar-cost average into tokens on a schedule — auto-swap SOL for target tokens',
        category: 'trading',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'activity',
        prompt: `Execute DCA strategy for {{circle_name}}. Check each member's trading bot config:
1. Review DCA targets (token + amount per interval)
2. Check wallet SOL balance — enough for the swap + fees?
3. Get current price and compare to member's price limits (if set)
4. If conditions met, execute the swap via Helius/Jupiter
5. Log: token bought, amount, price, tx hash, remaining balance

If a member's balance is too low, alert them. If price is above their limit, skip and note why.
Output as JSON: [{user_id, action, token, amount_sol, amount_token, price, tx_hash, status}]`,
        include_context: { members: true, trading: true },
    spirit: 'devops',
        suggested: true,
        suggestedIconBg: '#0d2a0d',
      },
      {
        id: 'suggest-trade-alerts',
        name: 'Trade alerts',
        icon: '🚨',
        description: 'Real-time alerts when tokens hit price targets, stop-losses, or volume spikes',
        category: 'trading',
        trigger_type: 'schedule',
        cron_expression: 'every_6h',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: `Check price alerts for {{circle_name}}'s trading watchlist:
1. For each token on the watchlist, check current price vs alert targets
2. PRICE TARGET HIT — token reached the member's take-profit price
3. STOP-LOSS TRIGGERED — token dropped below the member's stop price
4. VOLUME SPIKE — 3x+ normal volume in the last hour (potential breakout or dump)
5. LIQUIDITY WARNING — pool liquidity dropped >30% in 24h

For triggered alerts: tag the member, show current price vs target, suggest action (take profit / cut loss / hold). If no alerts triggered, respond with SKIP.`,
        include_context: { members: true, trading: true },
    spirit: 'researcher',
        suggested: true,
        suggestedIconBg: '#2a1a0d',
      },
      {
        id: 'suggest-copy-trade',
        name: 'Copy trade tracker',
        icon: '👀',
        description: 'Track whale wallets and notable traders — alert when they make moves',
        category: 'trading',
        trigger_type: 'schedule',
        cron_expression: 'every_6h',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Monitor tracked wallets for {{circle_name}}'s copy trading:
1. Check each tracked wallet's recent transactions (last 6h)
2. For each trade: what they bought/sold, amount, price, DEX used
3. Analyze the pattern — accumulating? distributing? new position?
4. If a tracked wallet made a significant swap (>$1k): alert the circle with details
5. Success rate — how have previous signals from this wallet performed?

Format as a feed of trades with context. Only show wallets with new activity.`,
        include_context: { members: true, trading: true },
    spirit: 'researcher',
        suggested: true,
        suggestedIconBg: '#1a0d1a',
      },
      {
        id: 'suggest-pnl-report',
        name: 'P&L report',
        icon: '💰',
        description: 'Daily profit/loss report across all trading activity for circle members',
        category: 'trading',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Generate a daily P&L report for {{circle_name}}'s traders:
1. For each member with a connected wallet:
   - Total portfolio value (now vs 24h ago)
   - Realized P&L (from completed swaps today)
   - Unrealized P&L (open positions vs entry price)
   - Best trade (highest % gain)
   - Worst trade (biggest % loss)
   - Total fees paid (gas + DEX fees)
2. Circle leaderboard — rank members by daily P&L
3. Risk metrics — any member with >50% of portfolio in one token
4. Weekly trend — is the circle net profitable this week?

Format as a clean financial report. Use 🟢 for gains, 🔴 for losses.`,
        include_context: { members: true, analytics: true, trading: true },
    spirit: 'pm',
        suggested: true,
        suggestedIconBg: '#0d2a1a',
      },
    ],
  },

  // ── Knowledge & Learning ──────────────────────────────────────────────────
  {
    key: 'learning',
    label: 'Knowledge & Learning',
    icon: '🧠',
    templates: [
      {
        id: 'suggest-tech-radar',
        name: 'Tech radar',
        icon: '📡',
        description: 'Scan dev blogs, Hacker News, and release feeds for relevant tech updates',
        category: 'learning',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Tech radar scan for {{circle_name}}. Based on the team's tech stack (check rooms and recent tasks for technologies used), research and report:

1. **New Releases** — major version bumps in frameworks/libraries the team uses (React, Expo, Supabase, Three.js, etc.)
2. **Security Advisories** — any CVEs or vulnerability reports affecting dependencies
3. **Trending Tools** — new dev tools gaining traction in the team's ecosystem
4. **Breaking Changes** — upcoming deprecations or migration requirements
5. **Industry Shifts** — significant technical trends relevant to the project

For each item: title, one-line summary, relevance to this team (high/medium/low), action needed (update/watch/none). Store key findings as knowledge for future reference. Max 10 items, sorted by relevance.`,
        include_context: { members: true, rooms: true, tasks: true, analytics: true },
        spirit: 'researcher',
        suggested: true,
        suggestedIconBg: '#0d1a2a',
      },
      {
        id: 'suggest-dependency-monitor',
        name: 'Dependency monitor',
        icon: '📦',
        description: 'Track package updates, deprecations, and security vulnerabilities in project dependencies',
        category: 'learning',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Dependency audit for {{circle_name}}. Analyze the project's dependency tree:

1. **Outdated Packages** — list packages more than 2 major versions behind, with migration difficulty (easy/medium/hard)
2. **Security Vulnerabilities** — check for known CVEs in current dependency versions. Severity: critical/high/medium/low
3. **Deprecated Packages** — identify packages marked deprecated or unmaintained (no commits in 12+ months)
4. **Size Bloat** — flag unusually large dependencies that could be replaced with lighter alternatives
5. **Duplicate Dependencies** — packages that serve the same purpose and could be consolidated

For each finding: package name, current version, recommended action, estimated effort. Create tasks for critical items.`,
        include_context: { rooms: true, tasks: true },
        spirit: 'security',
        suggested: true,
        suggestedIconBg: '#1a0d0d',
      },
      {
        id: 'suggest-market-intelligence',
        name: 'Market intelligence',
        icon: '🌐',
        description: 'Daily crypto market report — macro trends, sector rotation, sentiment analysis, key events',
        category: 'learning',
        trigger_type: 'schedule',
        cron_expression: 'daily',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Daily market intelligence brief for {{circle_name}}. Compile and analyze:

1. **Macro Overview** — BTC dominance, total crypto market cap trend, Fear & Greed Index reading, DXY direction
2. **Solana Ecosystem** — SOL price + 24h change, network TPS, notable protocol launches/updates, TVL changes
3. **Sector Rotation** — which sectors are outperforming (DeFi, AI, memecoins, DePIN, L2s, gaming)
4. **Narrative Detection** — emerging themes from crypto Twitter/news that could drive price action in 24-72h
5. **Key Events** — token unlocks, protocol upgrades, regulatory news, ETF flow data
6. **Sentiment Score** — aggregate market sentiment 1-100 with brief reasoning
7. **Actionable Intel** — 2-3 specific observations the team should watch

Store key learnings as spirit knowledge. Reference the team's current holdings and watchlist from trading data.`,
        include_context: { members: true, trading: true, analytics: true },
        spirit: 'analyst',
        suggested: true,
        suggestedIconBg: '#0d1a1a',
      },
      {
        id: 'suggest-trading-journal-review',
        name: 'Trading journal review',
        icon: '📔',
        description: 'AI reviews trade history to identify winning patterns, mistakes, and strategy improvements',
        category: 'learning',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Weekly trading journal review for {{circle_name}}. Analyze all trades from the past 7 days:

1. **Performance Summary** — win rate, average return, total P&L, best/worst trade
2. **Pattern Recognition** — what market conditions led to winners vs losers? Time of day? Token category? Position size?
3. **Strategy Scoring** — score each strategy used (DCA, momentum, mean reversion, copy trade): win rate + avg return per strategy
4. **Mistakes Identified** — common errors: chasing pumps, holding losers too long, position sizing too large, ignoring stops
5. **Regime Analysis** — was the market trending/ranging/volatile this week? Which strategies worked in this regime?
6. **Learning Points** — 3 specific, actionable learnings to improve next week's trading
7. **Strategy Adjustments** — recommend parameter changes: tighter stops? larger DCA amounts? different entry criteria?

Save high-confidence learnings as spirit knowledge entries. These will inform future trade proposals. Format as a structured report.`,
        include_context: { members: true, trading: true, analytics: true },
        spirit: 'trader',
        suggested: true,
        suggestedIconBg: '#1a0d2a',
      },
      {
        id: 'suggest-spirit-evolution',
        name: 'Spirit knowledge builder',
        icon: '🧬',
        description: 'Continuously evolve spirit knowledge by researching latest developments in each domain',
        category: 'learning',
        trigger_type: 'schedule',
        cron_expression: 'weekly',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'activity',
        prompt: `Knowledge evolution cycle for {{circle_name}}. Research and synthesize new knowledge for each active spirit:

**For Engineering spirits (sr-engineer, devops, security):**
- Latest framework updates and best practices
- New CI/CD patterns and tools gaining adoption
- Security advisories and emerging threat vectors
- Performance optimization techniques

**For Trading spirits (trader, analyst):**
- New DeFi protocols and yield opportunities on Solana
- Updated market microstructure insights
- New on-chain analytics tools and data sources (Birdeye, DexScreener, Nansen updates)
- Risk management framework refinements
- Regulatory developments affecting crypto trading

**For Leadership spirits (pm, tech-lead, coach):**
- AI-enhanced project management patterns
- Team velocity optimization techniques
- Remote collaboration best practices

For each spirit: identify 2-3 new learnings with sources. Grade confidence (high/medium/low). Format as structured knowledge entries that can be injected into spirit prompts. Focus on actionable, specific knowledge — not generic advice.`,
        include_context: { members: true, rooms: true, tasks: true, analytics: true, trading: true, goals: true },
        spirit: 'researcher',
        suggested: true,
        suggestedIconBg: '#1a1a0d',
      },
      {
        id: 'suggest-onchain-patterns',
        name: 'On-chain pattern scanner',
        icon: '🔗',
        description: 'Detect on-chain patterns — whale accumulation, smart money flows, liquidity shifts',
        category: 'learning',
        trigger_type: 'schedule',
        cron_expression: 'every_6h',
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `On-chain pattern analysis for {{circle_name}}. Analyze blockchain activity:

1. **Whale Movements** — large wallet transfers (>$100K) in tokens the circle tracks. Classify: accumulation, distribution, exchange deposit (likely sell), exchange withdrawal (likely hold)
2. **Smart Money Flows** — track net flow direction of top profitable wallets. Are they buying or selling?
3. **Liquidity Changes** — significant LP additions/removals. Flag any token where >10% of liquidity was removed
4. **New Token Activity** — tokens with rapid holder growth (>100 new holders/hour) or unusual volume spikes (>5x normal)
5. **Exchange Flows** — net SOL/USDC flow direction across major exchanges. Inflow = selling pressure, outflow = accumulation
6. **Confluence Score** — for each token in the watchlist: combine whale activity + liquidity health + holder growth into a 0-100 score

Only report actionable findings. Skip tokens with no significant activity. Save pattern insights as spirit knowledge.`,
        include_context: { trading: true, analytics: true },
        spirit: 'analyst',
        suggested: true,
        suggestedIconBg: '#0d2a1a',
      },
      {
        id: 'suggest-sentiment-pulse',
        name: 'Sentiment pulse',
        icon: '💭',
        description: 'Real-time social sentiment scoring for tracked tokens from Twitter, Discord, news',
        category: 'learning',
        trigger_type: 'schedule',
        cron_expression: 'every_6h',
        agent: 'BlackSwan',
        model: 'claude-haiku',
        output_target: 'chat',
        prompt: `Sentiment pulse for {{circle_name}}. For each token in the trading watchlist and portfolio:

1. **Social Buzz Score** (0-100) — estimated social volume and engagement trending direction
2. **Sentiment Ratio** — bullish vs bearish signal ratio from available data
3. **Narrative Alignment** — is this token part of a trending narrative? (AI, memecoins, DePIN, RWA, gaming)
4. **Influencer Activity** — any notable figures or large accounts discussing this token
5. **News Impact** — recent news articles or announcements that could affect price
6. **Contrarian Signals** — extreme greed (>80) may indicate distribution phase; extreme fear (<20) may indicate accumulation opportunity

Output a sentiment dashboard: token | buzz | sentiment | narrative | signal (bullish/neutral/bearish). Flag any token with a dramatic sentiment shift (>30 point change in 24h). If no significant changes, respond with SKIP.`,
        include_context: { trading: true },
        spirit: 'analyst',
        suggested: true,
        suggestedIconBg: '#1a0d1a',
      },
      {
        id: 'suggest-pr-impact-analyzer',
        name: 'PR impact analyzer',
        icon: '🔬',
        description: 'Analyze PR diffs for risk, complexity, test coverage gaps, and breaking changes',
        category: 'learning',
        trigger_type: 'event',
        event_config: { provider: 'github', event: 'pull_request_opened' },
        agent: 'BlackSwan',
        model: 'claude-sonnet',
        output_target: 'chat',
        prompt: `Analyze the pull request for {{circle_name}}. PR data: {{event}}.

1. **Risk Score** (1-10) — based on: files changed, lines modified, complexity delta, areas touched (auth, payments, data migrations = high risk)
2. **Breaking Changes** — any API signature changes, removed exports, schema migrations, env var changes
3. **Test Coverage** — are new code paths tested? Suggest specific test cases for untested logic
4. **Security Review** — check for: SQL injection, XSS, exposed secrets, auth bypasses, insecure dependencies
5. **Performance Impact** — any new database queries, API calls, or heavy computations in hot paths?
6. **Dependencies** — new packages added? Check for size, maintenance status, known vulnerabilities
7. **Summary** — 3-sentence TL;DR of what this PR does and its impact

Post as a structured review comment. Flag anything that should block merge.`,
        include_context: { rooms: true, tasks: true },
        spirit: 'sr-engineer',
        suggested: true,
        suggestedIconBg: '#0d0d2a',
      },
    ],
  },
];

// Flat list for backwards compat
export const SUGGESTED_TEMPLATES: AutomationTemplate[] = SUGGESTED_GROUPS.flatMap(g => g.templates);
