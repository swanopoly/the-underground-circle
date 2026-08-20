import {
  CHAT_COMMAND_REGISTRY,
  type ChatCommandRouteId,
  type ChatSlashCommandCategory,
} from './chatCommandRegistry';
import type { SessionPromptAction } from './sessionPromptCatalog';

export type QuickActionMode = 'send' | 'prefill' | 'special';
export type ChatActionRisk = 'routine' | 'external' | 'sensitive' | 'destructive';
export type ChatActionPlatform = 'all' | 'web';

export type QuickActionItem = {
  id: string;
  label: string;
  description: string;
  text: string;
  mode: QuickActionMode;
  routeId: ChatCommandRouteId | null;
  platform?: ChatActionPlatform;
  risk?: ChatActionRisk;
  keywords?: string[];
};

export type FeaturedToolAction = {
  id: string;
  label: string;
  description: string;
  text: string;
  color: string;
  flatIcon?: string;
  mode: QuickActionMode;
  routeId: ChatCommandRouteId | null;
  platform?: ChatActionPlatform;
  risk?: ChatActionRisk;
};

export type PromptCategoryItem = {
  label: string;
  desc: string;
  text: string;
};

export type PromptCategory = {
  title: string;
  color: string;
  prompts: PromptCategoryItem[];
};

export type ChatActionMenuEntry = Readonly<{
  id: string;
  label: string;
  description: string;
  text: string;
  mode: QuickActionMode;
  routeId: ChatCommandRouteId | null;
  color: string;
  sectionId: string;
  platform: ChatActionPlatform;
  risk: ChatActionRisk;
  keywords: readonly string[];
}>;

export type ChatActionMenuSection = Readonly<{
  id: string;
  label: string;
  description: string;
  color: string;
  items: readonly ChatActionMenuEntry[];
}>;

export type ChatActionMenuCatalog = Readonly<{
  contextual: readonly ChatActionMenuEntry[];
  common: readonly ChatActionMenuEntry[];
  sections: readonly ChatActionMenuSection[];
  searchItems: readonly ChatActionMenuEntry[];
}>;

function resolveSlashRoute(text: string): ChatCommandRouteId | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized.startsWith('/')) return null;

  const match = CHAT_COMMAND_REGISTRY
    .flatMap((entry) => [entry.command, ...(entry.aliases || [])].map((command) => ({ entry, command })))
    .filter(({ command }) => {
      const candidate = command.toLowerCase();
      return normalized === candidate || normalized.startsWith(`${candidate} `);
    })
    .sort((a, b) => b.command.length - a.command.length)[0];

  return match?.entry.routeId || null;
}

function withQuickActionRoutes(
  actions: ReadonlyArray<Pick<QuickActionItem, 'label' | 'text' | 'mode'> & Partial<Omit<QuickActionItem, 'label' | 'text' | 'mode' | 'routeId'>>>,
): QuickActionItem[] {
  return actions.map((action, index) => ({
    id: action.id || `quick-${action.text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || index}`,
    description: action.description || action.label.replace(/^[^A-Za-z0-9]+\s*/, ''),
    ...action,
    routeId: action.text === '__COMPUTER_USE__' ? 'browser' : resolveSlashRoute(action.text),
  }));
}

function withToolActionRoutes(
  actions: ReadonlyArray<Pick<FeaturedToolAction, 'label' | 'text' | 'color' | 'mode'> & Partial<Omit<FeaturedToolAction, 'label' | 'text' | 'color' | 'mode' | 'routeId'>>>,
): FeaturedToolAction[] {
  return actions.map((action, index) => ({
    id: action.id || `tool-${action.text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || index}`,
    description: action.description || action.label,
    ...action,
    routeId: resolveSlashRoute(action.text),
  }));
}

export const QUICK_PROMPTS: QuickActionItem[] = withQuickActionRoutes([
  { id: 'assign-agent', label: 'Assign agent', description: 'Choose an existing agent for this chat.', text: '__ASSIGN_AGENT__', mode: 'special' },
  { id: 'spawn-agent', label: 'Create agent', description: 'Open the agent creation workflow.', text: '__SPAWN_AGENT__', mode: 'special' },
  { id: 'openswan', label: 'OpenSwan', description: 'Open local agent controls and connections.', text: '__OPENSWAN__', mode: 'special', platform: 'web' },
  { id: 'computer-use', label: 'Use computer', description: 'Open the computer task composer.', text: '__COMPUTER_USE__', mode: 'special', platform: 'web', risk: 'external' },
  { id: 'pair-desktop', label: 'Pair desktop bridge', description: 'Connect this browser to a local desktop bridge.', text: '__PAIR_DESKTOP__', mode: 'special', platform: 'web', risk: 'external' },
  { id: 'my-tasks', label: 'My tasks', description: 'Ask for your open work in this circle.', text: 'my tasks', mode: 'send' },
  { id: 'github-help', label: 'GitHub', description: 'Fill the composer with GitHub command help.', text: '/gh help', mode: 'prefill' },
  { id: 'rooms-help', label: 'Rooms', description: 'Fill the composer with project room help.', text: '/room help', mode: 'prefill' },
  { id: 'summarize', label: 'Summarize', description: 'Summarize text, a file, or a URL.', text: '/summarize ', mode: 'prefill' },
  { id: 'translate', label: 'Translate', description: 'Translate text into another language.', text: '/translate ', mode: 'prefill' },
  { id: 'imagine', label: 'Create image', description: 'Describe an image to generate.', text: '/imagine ', mode: 'prefill' },
  { id: 'check-in', label: 'Check in', description: 'Draft a concise progress check-in.', text: '__CHECK_IN__', mode: 'prefill' },
  { id: 'new-task', label: 'New task', description: 'Open the task form with a title.', text: '__NEW_TASK__', mode: 'prefill' },
  { id: 'daily-plan', label: 'Daily plan', description: 'Ask for a prioritized plan from current work.', text: 'daily plan', mode: 'send' },
  { id: 'circle-status', label: 'Circle status', description: 'Show current circle work and activity.', text: '/status', mode: 'send' },
  { id: 'my-streak', label: 'My streak', description: 'Review your current accountability streak.', text: 'my streak', mode: 'send' },
  { id: 'proposals', label: 'Proposals', description: 'Review open proposals and polls.', text: '/proposals', mode: 'send' },
  { id: 'send-crypto', label: 'Send crypto', description: 'Open a reviewed wallet transfer flow.', text: '__SEND_CRYPTO__', mode: 'special', platform: 'web', risk: 'sensitive' },
  { id: 'challenge', label: 'Challenge a member', description: 'Draft a challenge for a circle member.', text: 'challenge a member', mode: 'prefill' },
  { id: 'play-game', label: 'Play a game', description: 'Start a lightweight circle game.', text: 'play a game', mode: 'send' },
  { id: 'trivia', label: 'Trivia', description: 'Start a trivia round.', text: 'trivia', mode: 'send' },
  { id: 'would-you-rather', label: 'Would you rather', description: 'Start a would-you-rather prompt.', text: 'would you rather', mode: 'send' },
  { id: 'hot-take', label: 'Hot take', description: 'Get a discussion prompt for the circle.', text: 'hot take', mode: 'send' },
  { id: 'step-away', label: 'Step away', description: 'Draft a clear handoff before leaving.', text: '__STEP_AWAY__', mode: 'prefill' },
  { id: 'help', label: 'Chat help', description: 'Show available commands and workflows.', text: '/help', mode: 'send' },
  { id: 'delete-chat', label: 'Delete my messages', description: 'Review removal of your messages in this chat.', text: '__NUKE__', mode: 'special', risk: 'destructive' },
]);

export const FEATURED_QUICK_ACTIONS = QUICK_PROMPTS.slice(0, 7);
export const ALL_QUICK_ACTIONS = QUICK_PROMPTS;

export const FEATURED_TOOL_ACTIONS: FeaturedToolAction[] = withToolActionRoutes([
  { id: 'tool-image', label: 'Image', description: 'Create an image from a description.', text: '/imagine ', color: '#f43f5e', flatIcon: 'designer', mode: 'prefill' },
  { id: 'tool-speak', label: 'Speak', description: 'Turn text into speech.', text: '/speak ', color: '#06b6d4', mode: 'prefill' },
  { id: 'tool-code', label: 'Code', description: 'Generate or revise code.', text: '/code ', color: '#22c55e', flatIcon: 'code', mode: 'prefill' },
  { id: 'tool-wordpress', label: 'WordPress', description: 'Open WordPress command help.', text: '/wp help', color: '#21759b', flatIcon: 'wordpress', mode: 'prefill' },
  { id: 'tool-summarize', label: 'Summarize', description: 'Summarize text, a file, or a URL.', text: '/summarize ', color: '#f59e0b', flatIcon: 'writer', mode: 'prefill' },
  { id: 'tool-translate', label: 'Translate', description: 'Translate text into another language.', text: '/translate ', color: '#8b5cf6', mode: 'prefill' },
  { id: 'tool-build-page', label: 'Build page', description: 'Generate a webpage from a brief.', text: '/build-page ', color: '#3b82f6', flatIcon: 'architect', mode: 'prefill' },
  { id: 'tool-computer', label: 'Computer task', description: 'Plan a browser or desktop task.', text: '/browser plan ', color: '#14b8a6', mode: 'prefill' },
  { id: 'tool-all', label: 'All AI tools', description: 'Show available AI tool commands.', text: '/hf help', color: '#eab308', flatIcon: 'brain', mode: 'prefill' },
]);

export const PROMPT_CATEGORIES: PromptCategory[] = [
  {
    title: 'COMMANDS',
    color: '#f59e0b',
    prompts: [
      { label: 'Mission Status', desc: 'See all active missions', text: '/mission' },
      { label: 'New Mission', desc: 'Create from chat', text: '/mission create ' },
      { label: 'Full Summary', desc: 'Missions + proof + stats', text: '/summary' },
      { label: 'My Tasks', desc: 'See your open tasks', text: 'my tasks' },
      { label: 'Task Board', desc: 'Full circle overview', text: 'tasks' },
      { label: 'Circle Status', desc: 'Check-ins, tasks, members', text: 'status' },
      { label: 'Search Chat', desc: 'Find old messages', text: '/search ' },
      { label: 'Pinned Messages', desc: 'See pinned msgs', text: '/pins' },
      { label: 'Schedule Action', desc: 'Queue a recurring task', text: '/schedule ' },
      { label: 'Cron List', desc: 'See pending actions', text: '/cron list' },
    ],
  },
  {
    title: 'CREATE',
    color: '#6366f1',
    prompts: [
      { label: 'Build Page', desc: 'Generate a webpage', text: '/build-page ' },
      { label: 'Code', desc: 'Generate code', text: '/code ' },
      { label: 'Summarize', desc: 'Summarize text or URL', text: '/summarize ' },
      { label: 'Translate', desc: 'Translate to another language', text: '/translate ' },
      { label: 'Daily Plan', desc: 'AI daily priorities', text: 'daily plan' },
      { label: 'What should I work on?', desc: 'AI picks your next task', text: 'Based on our active missions, what should I work on next?' },
    ],
  },
  {
    title: 'DESIGN APPS',
    color: '#f472b6',
    prompts: [
      { label: 'Photoshop Save Web', desc: 'Save active image as web JPG/PNG', text: 'Open Photoshop and save the image as export.jpg' },
      { label: 'Photoshop AI Fill', desc: 'Run generative fill on selection', text: 'Open Photoshop and use generative fill to add ' },
      { label: 'Photoshop Fill Selection', desc: 'Generative Fill highlighted area', text: 'Open Photoshop and fill selected area with ' },
      { label: 'Photoshop Box Fill', desc: 'Select coordinates then fill with AI', text: 'Open Photoshop and select area from 100,100 to 500,500 then generative fill with ' },
      { label: 'Photoshop Remove Selection', desc: 'Blank-prompt fill to remove highlighted area', text: 'Open Photoshop and remove highlighted section with generative fill' },
      { label: 'Photoshop Selection Brush', desc: 'Prep brush highlight workflow for AI fill', text: 'Open Photoshop and use selection brush tool for generative fill' },
      { label: 'Photoshop Brush Fill', desc: 'Paint a selection stroke then AI fill', text: 'Open Photoshop and use selection brush from 100,100 to 500,500 then generative fill with ' },
      { label: 'Photoshop AI Edit', desc: 'Prompt Photoshop AI to change the active image', text: 'Open Photoshop and AI edit the image to ' },
      { label: 'Photoshop Replace BG', desc: 'Select subject and generate a new background', text: 'Open Photoshop and replace background with ' },
      { label: 'Photoshop Remove BG', desc: 'Select subject and remove background', text: 'Open Photoshop and remove background' },
      { label: 'Photoshop Harmonize', desc: 'Match selected object lighting/color to background', text: 'Open Photoshop and harmonize selected object with background' },
      { label: 'Photoshop Social Canvas', desc: 'Create preset social layout and seed AI art', text: 'Open Photoshop and create Instagram post canvas with ' },
      { label: 'Photoshop Batch', desc: 'Open image processor workflow', text: 'Open Photoshop and run image processor' },
      { label: 'Photoshop Sky', desc: 'Select sky for replacement or AI edits', text: 'Open Photoshop and select sky' },
      { label: 'Photoshop Layers', desc: 'Export layers to files', text: 'Open Photoshop and export layers to files' },
      { label: 'InDesign Banner Workspace', desc: 'Open layer, link, style, merge, align, and preflight panels', text: 'Open InDesign and prep banner workflow' },
      { label: 'InDesign Object Layers', desc: 'Change placed PSD/PDF/AI layer visibility', text: 'Open InDesign and show object layer options for selected graphic' },
      { label: 'InDesign Banner Text', desc: 'Replace selected banner headline/CTA/copy', text: 'Open InDesign and set selected banner headline to ' },
      { label: 'Dealer Disclaimer', desc: 'Update disclaimer/legal copy in open banner', text: 'Change disclaimer to ' },
      { label: 'Dealer APR', desc: 'Update finance, lease, APR, or payment offer', text: 'Update APR to ' },
      { label: 'Dealer Price', desc: 'Update sale price or MSRP layer', text: 'Update sale price to ' },
      { label: 'Dealer Find/Replace', desc: 'Exact disclaimer text swap with InDesign Find/Change', text: 'Replace "old disclaimer" with "new disclaimer" in InDesign' },
      { label: 'Dealer Proof', desc: 'Open legal review, preflight, links, and layers', text: 'Prep dealership banner for legal review' },
      { label: 'InDesign Banner Asset', desc: 'Replace selected banner image/logo/background', text: 'Open InDesign and replace selected banner image with ~/Desktop/hero.png' },
      { label: 'InDesign Variable Banners', desc: 'Set up Data Merge production for banner variants', text: 'Open InDesign and set up variable banners with data merge' },
      { label: 'InDesign Banner Export', desc: 'Export selected banner/page/spread', text: 'Open InDesign and export selected banner as banner.jpg' },
      { label: 'InDesign Text Image', desc: 'Generate Firefly image inside layout', text: 'Open InDesign and generate image of ' },
      { label: 'InDesign Gen Expand', desc: 'Expand selected placed image with AI', text: 'Open InDesign and generative expand selected image' },
      { label: 'InDesign Gen Fill', desc: 'Fill selected frame or image area with AI', text: 'Open InDesign and generative fill with ' },
      { label: 'InDesign Place', desc: 'Place image or asset into layout', text: 'Open InDesign and place ~/Desktop/logo.png' },
      { label: 'InDesign Brochure', desc: 'Create a tri-fold brochure document setup', text: 'Open InDesign and create tri-fold brochure layout' },
      { label: 'InDesign Alt Text', desc: 'Generate accessibility alt text for selected art', text: 'Open InDesign and generate alt text' },
      { label: 'InDesign Export PDF', desc: 'Export using PDF preset', text: 'Open InDesign and export high quality pdf as brochure.pdf' },
      { label: 'InDesign Preflight', desc: 'Check output readiness', text: 'Open InDesign and show preflight panel' },
      { label: 'InDesign Package', desc: 'Collect fonts and linked assets', text: 'Open InDesign and package document' },
      { label: 'InDesign Data Merge', desc: 'Open variable layout tooling', text: 'Open InDesign and show data merge panel' },
      { label: 'InDesign Page #', desc: 'Insert current page marker', text: 'Open InDesign and insert current page number' },
    ],
  },
  {
    title: 'MAC DASHBOARD',
    color: '#60a5fa',
    prompts: [
      { label: 'Spotlight Search', desc: 'Search and launch from Spotlight', text: 'Search Spotlight for Photoshop' },
      { label: 'Mission Control', desc: 'Show all spaces and windows', text: 'Show Mission Control' },
      { label: 'Finder Downloads', desc: 'Open Downloads in Finder', text: 'Open Finder Downloads' },
      { label: 'Finder List View', desc: 'Switch Finder to list view', text: 'Set Finder to list view' },
      { label: 'System Settings', desc: 'Open a permissions/settings pane', text: 'Open System Settings Accessibility' },
      { label: 'Screenshot Area', desc: 'Start selected-area screenshot', text: 'Take selection screenshot' },
      { label: 'Show Desktop', desc: 'Reveal the desktop', text: 'Show desktop' },
      { label: 'Lock Mac', desc: 'Lock the local screen', text: 'Lock my Mac' },
    ],
  },
  {
    title: 'GMAIL',
    color: '#ea4335',
    prompts: [
      { label: 'Open Inbox', desc: 'Open Gmail inbox locally', text: 'Open Gmail inbox' },
      { label: 'Search Mail', desc: 'Jump to Gmail search', text: 'Search Gmail for ' },
      { label: 'Draft Email', desc: 'Open compose with details', text: 'Draft Gmail to ' },
      { label: 'Open Drafts', desc: 'Review unsent drafts', text: 'Open Gmail drafts' },
      { label: 'Open Sent', desc: 'Review sent mail', text: 'Open Gmail sent' },
      { label: 'Schedule Draft', desc: 'Queue a Gmail draft action', text: '/schedule gmail_draft ' },
    ],
  },
  {
    title: 'WORDPRESS',
    color: '#22c55e',
    prompts: [
      { label: 'WP Draft', desc: 'AI writes a post draft', text: '/wp draft ' },
      { label: 'WP Publish', desc: 'Push a draft live', text: '/wp publish ' },
      { label: 'WP Schedule', desc: 'Queue for a future date', text: '/wp schedule ' },
      { label: 'WP Status', desc: 'Check your connected site', text: '/wp status' },
      { label: 'Open Admin', desc: 'Open WordPress dashboard', text: 'Open WordPress dashboard' },
      { label: 'New Post', desc: 'Open the post editor', text: 'Open WordPress new post' },
      { label: 'Post List', desc: 'Open all posts', text: 'Open WordPress posts' },
      { label: 'Media Library', desc: 'Open media uploads', text: 'Open WordPress media library' },
      { label: 'Categories', desc: 'Open category manager', text: 'Open WordPress categories' },
      { label: 'Connected Posts', desc: 'List via the API', text: '/wp list' },
    ],
  },
  {
    title: 'PUBLISH',
    color: '#22c55e',
    prompts: [
      { label: 'Create Proposal', desc: 'Put something to a vote', text: '/propose ' },
      { label: 'Quick Poll', desc: 'Ask the crew a question', text: '/poll ' },
    ],
  },
  {
    title: 'WALLET',
    color: '#f97316',
    prompts: [
      { label: 'Send Crypto', desc: 'Send ETH/SOL to a member', text: '__SEND_CRYPTO__' },
      { label: 'My Wallet', desc: 'Check wallet status', text: 'my wallet' },
      { label: 'Tip a Member', desc: 'Send a small tip', text: '__TIP__' },
    ],
  },
];

const QUICK_ACTION_OVERRIDES: Record<string, { mode: QuickActionMode; text: string; routeId?: ChatCommandRouteId | null }> = {
  '__tip__': { mode: 'special', text: '__TIP__' },
  '__send_crypto__': { mode: 'special', text: '__SEND_CRYPTO__' },
  '__check_in__': { mode: 'prefill', text: 'Log this check-in: ' },
  '__new_task__': { mode: 'prefill', text: '/task new ' },
  '__step_away__': { mode: 'prefill', text: "I'm stepping away. Help me write a clear handoff for " },
  '__assign_agent__': { mode: 'special', text: '__ASSIGN_AGENT__' },
  '__spawn_agent__': { mode: 'special', text: '__SPAWN_AGENT__' },
  '__spawn_agents__': { mode: 'special', text: '__SPAWN_AGENTS__' },
  '__log_proof__': { mode: 'special', text: '__LOG_PROOF__' },
  '__open_search__': { mode: 'special', text: '__OPEN_SEARCH__' },
  '__open_games__': { mode: 'special', text: '__OPEN_GAMES__' },
  '__computer_use__': { mode: 'special', text: '__COMPUTER_USE__', routeId: 'browser' },
  '__openswan__': { mode: 'special', text: '__OPENSWAN__' },
  '__pair_desktop__': { mode: 'special', text: '__PAIR_DESKTOP__' },
  '__nuke__': { mode: 'special', text: '__NUKE__' },
  'status': { mode: 'send', text: '/status' },
  'daily plan': {
    mode: 'send',
    text: 'Based on my active tasks, recent activity, and current circle context, give me a concrete daily plan with one top priority, two follow-ups, and the order I should tackle them.',
  },
  'tasks': {
    mode: 'send',
    text: 'Show me the current task board for this circle with what is open, in progress, blocked, and done.',
  },
  'focus': {
    mode: 'send',
    text: 'Based on my active tasks and current circle context, set a focused work block for me right now with one primary task, a 25-minute plan, and what I should ignore until it is done.',
  },
  'accountability': {
    mode: 'send',
    text: 'Give me a direct accountability report based on my recent work, streak, and open tasks. Tell me what I am avoiding and what I should finish next.',
  },
  'challenge a member': { mode: 'prefill', text: 'challenge @' },
  'play a game': { mode: 'send', text: "Let's play a game. Pick the best option for this chat and start immediately." },
  'trivia': { mode: 'send', text: 'Start a trivia round right now and give the first question.' },
  'would you rather': { mode: 'send', text: 'Give me a strong would-you-rather prompt and keep it fun.' },
  'hot take': { mode: 'send', text: 'Give me one sharp hot take to react to.' },
  'two truths': { mode: 'send', text: 'Start a two truths and a lie round and give the first set.' },
  'this or that': { mode: 'send', text: 'Give me a fast this-or-that prompt with 5 strong either-or choices.' },
  'rate my day': { mode: 'prefill', text: 'rate my day ' },
  'roast battle': { mode: 'send', text: 'Start a light roast battle prompt for the circle. Keep it funny, not mean.' },
  'speed task': { mode: 'send', text: 'Give the circle a short speed-task challenge with a clear goal, timer, and win condition.' },
  'dare': { mode: 'send', text: 'Give the circle a daily dare that is fun and safe.' },
  'weekly review': {
    mode: 'send',
    text: 'Based on my recent activity, tasks, and streaks, give me a concise weekly review: wins, misses, lessons, and next focus.',
  },
  'mvp of the week': { mode: 'send', text: 'Based on recent circle activity, who is the MVP of the week and why?' },
  'my wallet': { mode: 'special', text: '__MY_WALLET__' },
  'set a bounty on a task': { mode: 'prefill', text: 'set a bounty on task ' },
  "what's happening on discord": {
    mode: 'send',
    text: "What's happening on Discord right now? Summarize the most important activity and call out anything I should know.",
  },
  'icebreaker': { mode: 'send', text: 'Give the circle one strong icebreaker question to kick off conversation.' },
  'shoutout': { mode: 'prefill', text: 'write a shoutout for ' },
  'motivate me': { mode: 'send', text: 'Give me a sharp, high-energy motivation hit based on what I need to get done.' },
  'roast me': { mode: 'send', text: 'Give me a funny accountability roast that pushes me to get moving without being cruel.' },
  'quote': { mode: 'send', text: 'Give me one strong quote of the day and one sentence on why it matters right now.' },
  'pep talk': { mode: 'send', text: 'Give me a personalized pep talk for the work in front of me right now.' },
};

export function resolveQuickActionExecution(text: string): { mode: QuickActionMode; text: string; routeId: ChatCommandRouteId | null } {
  const normalized = text.trim().toLowerCase();
  const override = QUICK_ACTION_OVERRIDES[normalized];
  if (override) return { ...override, routeId: override.routeId ?? resolveSlashRoute(override.text) };

  const action =
    QUICK_PROMPTS.find(item => item.text === text) ||
    FEATURED_TOOL_ACTIONS.find(item => item.text === text);
  const mode = action?.mode || (text.endsWith(' ') ? 'prefill' : 'send');
  return { mode, text, routeId: action?.routeId ?? resolveSlashRoute(text) };
}

export function mergeChatActionDraft(currentDraft: string, actionText: string): string {
  if (!currentDraft.trim()) return actionText;
  if (!actionText.trim()) return currentDraft;
  if (currentDraft.includes(actionText.trim())) return currentDraft;
  const separator = /\s$/.test(currentDraft) ? '' : '\n\n';
  return `${currentDraft}${separator}${actionText}`;
}

const CATEGORY_PRESENTATION: Record<ChatSlashCommandCategory, { label: string; color: string }> = {
  general: { label: 'General', color: '#64748b' },
  knowledge: { label: 'Knowledge', color: '#38bdf8' },
  memory: { label: 'Memory', color: '#8b5cf6' },
  missions: { label: 'Missions', color: '#22c55e' },
  rooms: { label: 'Rooms', color: '#06b6d4' },
  github: { label: 'GitHub', color: '#94a3b8' },
  wordpress: { label: 'WordPress', color: '#21759b' },
  ai_tools: { label: 'AI tools', color: '#6366f1' },
  governance: { label: 'Circle', color: '#f59e0b' },
  vault: { label: 'Vault', color: '#14b8a6' },
};

const DESTRUCTIVE_COMMAND_IDS = new Set(['forget', 'mission-complete', 'wp-delete', 'vault-revoke']);

function registryMenuEntry(
  command: (typeof CHAT_COMMAND_REGISTRY)[number],
): ChatActionMenuEntry {
  const presentation = CATEGORY_PRESENTATION[command.category];
  return {
    id: `command-${command.id}`,
    label: command.title,
    description: command.description,
    text: command.insertText,
    mode: 'prefill',
    routeId: command.routeId,
    color: presentation.color,
    sectionId: `registry-${command.category}`,
    platform: 'all',
    risk: DESTRUCTIVE_COMMAND_IDS.has(command.id) ? 'destructive' : 'routine',
    keywords: [command.command, ...(command.aliases || []), ...(command.keywords || [])],
  };
}

export const REGISTRY_BACKED_ACTION_SECTIONS: readonly ChatActionMenuSection[] = (
  Object.keys(CATEGORY_PRESENTATION) as ChatSlashCommandCategory[]
).map((category) => {
  const presentation = CATEGORY_PRESENTATION[category];
  return {
    id: `registry-${category}`,
    label: presentation.label,
    description: `Browse ${presentation.label.toLowerCase()} commands.`,
    color: presentation.color,
    items: CHAT_COMMAND_REGISTRY.filter((entry) => entry.category === category).map(registryMenuEntry),
  };
});

function quickMenuEntry(action: QuickActionItem): ChatActionMenuEntry {
  const resolved = resolveQuickActionExecution(action.text);
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    text: resolved.text,
    mode: resolved.mode,
    routeId: resolved.routeId,
    color: action.risk === 'destructive' ? '#ef4444' : '#6366f1',
    sectionId: action.risk === 'destructive' ? 'danger' : 'quick',
    platform: action.platform || 'all',
    risk: action.risk || 'routine',
    keywords: action.keywords || [],
  };
}

function legacyMenuEntry(category: PromptCategory, item: PromptCategoryItem, index: number): ChatActionMenuEntry {
  const resolved = resolveQuickActionExecution(item.text);
  const normalizedCategory = category.title.toLowerCase();
  const destructive = /\b(delete|remove|lock|revoke|forget|nuke)\b/i.test(`${item.label} ${item.text}`);
  const sensitive = normalizedCategory === 'wallet';
  const external = ['design apps', 'mac dashboard', 'gmail', 'wordpress'].includes(normalizedCategory);
  return {
    id: `legacy-${normalizedCategory.replace(/[^a-z0-9]+/g, '-')}-${item.label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-${index}`,
    label: item.label,
    description: item.desc,
    text: resolved.text,
    mode: resolved.mode === 'special' ? 'special' : 'prefill',
    routeId: resolved.routeId,
    color: category.color,
    sectionId: `legacy-${normalizedCategory.replace(/[^a-z0-9]+/g, '-')}`,
    platform: external || sensitive ? 'web' : 'all',
    risk: destructive ? 'destructive' : sensitive ? 'sensitive' : external ? 'external' : 'routine',
    keywords: [category.title, item.desc],
  };
}

function uniqueEntries(entries: readonly ChatActionMenuEntry[]): ChatActionMenuEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.mode}:${entry.text.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sectionEntries(categories: readonly ChatSlashCommandCategory[]): ChatActionMenuEntry[] {
  return REGISTRY_BACKED_ACTION_SECTIONS
    .filter((section) => categories.some((category) => section.id === `registry-${category}`))
    .flatMap((section) => section.items);
}

function legacyCategoryEntries(titles: readonly string[]): ChatActionMenuEntry[] {
  return PROMPT_CATEGORIES
    .filter((category) => titles.includes(category.title))
    .flatMap((category) => category.prompts
      .filter((item) => !(category.title === 'GMAIL' && item.label === 'Schedule Draft'))
      .map((item, index) => legacyMenuEntry(category, item, index)));
}

export function buildChatActionMenuCatalog(
  sessionActions: readonly SessionPromptAction[] = [],
): ChatActionMenuCatalog {
  const quick = QUICK_PROMPTS.map(quickMenuEntry);
  const dangerous = uniqueEntries([
    ...sectionEntries(['memory', 'missions', 'wordpress', 'vault']).filter((item) => item.risk === 'destructive'),
    ...quick.filter((item) => item.risk === 'destructive'),
    ...legacyCategoryEntries(['DESIGN APPS', 'MAC DASHBOARD', 'GMAIL', 'WORDPRESS', 'WALLET'])
      .filter((item) => item.risk === 'destructive'),
  ]);
  const safe = (items: readonly ChatActionMenuEntry[]) => uniqueEntries(items.filter((item) => item.risk !== 'destructive'));

  const sections: ChatActionMenuSection[] = [
    {
      id: 'create',
      label: 'Create & transform',
      description: 'Write, build, generate, summarize, and translate.',
      color: '#6366f1',
      items: safe([...sectionEntries(['ai_tools']), ...legacyCategoryEntries(['CREATE'])]),
    },
    {
      id: 'work',
      label: 'Work & organize',
      description: 'Tasks, missions, rooms, GitHub, and schedules.',
      color: '#22c55e',
      items: safe(sectionEntries(['general', 'missions', 'rooms', 'github'])),
    },
    {
      id: 'apps',
      label: 'Apps & computer',
      description: 'Browser, desktop, design apps, Gmail, and WordPress.',
      color: '#38bdf8',
      items: safe([...sectionEntries(['wordpress']), ...legacyCategoryEntries(['DESIGN APPS', 'MAC DASHBOARD', 'GMAIL', 'WORDPRESS'])]),
    },
    {
      id: 'circle',
      label: 'Circle & memory',
      description: 'Knowledge, memory, status, governance, and collaboration.',
      color: '#f59e0b',
      items: safe([
        ...sectionEntries(['knowledge', 'memory', 'governance']),
        ...legacyCategoryEntries(['PUBLISH']),
        ...quick.filter((item) => ![
          'assign-agent', 'spawn-agent', 'openswan', 'computer-use', 'pair-desktop', 'send-crypto', 'delete-chat',
        ].includes(item.id)),
      ]),
    },
    {
      id: 'setup',
      label: 'Connections & setup',
      description: 'Agents, OpenSwan, desktop pairing, and the vault.',
      color: '#14b8a6',
      items: safe([
        ...sectionEntries(['vault']),
        ...quick.filter((item) => ['assign-agent', 'spawn-agent', 'openswan', 'computer-use', 'pair-desktop'].includes(item.id)),
      ]),
    },
    {
      id: 'wallet',
      label: 'Wallet',
      description: 'Review wallet status and open confirmed transfer flows.',
      color: '#f97316',
      items: safe(legacyCategoryEntries(['WALLET'])),
    },
    {
      id: 'danger',
      label: 'Danger zone',
      description: 'Actions that remove or revoke data and require review.',
      color: '#ef4444',
      items: dangerous,
    },
  ].filter((section) => section.items.length > 0);

  const contextual = sessionActions.map<ChatActionMenuEntry>((action) => ({
    id: `context-${action.id}`,
    label: action.label,
    description: 'Use this session profile as the starting point for your draft.',
    text: action.prompt,
    mode: 'prefill',
    routeId: null,
    color: action.color,
    sectionId: 'suggested',
    platform: 'all',
    risk: 'routine',
    keywords: ['suggested', 'session'],
  }));
  const commonIds = new Set(['assign-agent', 'computer-use', 'my-tasks', 'new-task', 'check-in']);
  const common = quick.filter((item) => commonIds.has(item.id));
  const searchItems = uniqueEntries([...contextual, ...common, ...sections.flatMap((section) => section.items)]);

  return { contextual, common, sections, searchItems };
}
