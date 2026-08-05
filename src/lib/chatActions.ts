export type QuickActionMode = 'send' | 'prefill' | 'special';

export type QuickActionItem = {
  label: string;
  text: string;
  mode?: QuickActionMode;
};

export type FeaturedToolAction = {
  label: string;
  text: string;
  color: string;
  flatIcon?: string;
  mode: QuickActionMode;
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

export const QUICK_PROMPTS: QuickActionItem[] = [
  { label: '>_ Assign Agent', text: '__ASSIGN_AGENT__', mode: 'special' },
  { label: '+ Spawn Agent', text: '__SPAWN_AGENT__', mode: 'special' },
  { label: 'OS OpenSwan', text: '__OPENSWAN__', mode: 'special' },
  { label: '>_ Use Computer', text: '__COMPUTER_USE__', mode: 'special' },
  { label: '⎇ Pair Desktop Bridge', text: '__PAIR_DESKTOP__', mode: 'special' },
  { label: '📋 My Tasks', text: 'my tasks', mode: 'send' },
  { label: '</> GitHub', text: '/gh help', mode: 'send' },
  { label: '[] Rooms', text: '/room help', mode: 'send' },
  { label: 'AI Summarize', text: '/summarize ', mode: 'prefill' },
  { label: 'AI Translate', text: '/translate ', mode: 'prefill' },
  { label: 'AI Imagine', text: '/imagine ', mode: 'prefill' },
  { label: '✅ Check In', text: '__CHECK_IN__', mode: 'special' },
  { label: '📋 New Task', text: '__NEW_TASK__', mode: 'special' },
  { label: '📅 Daily Plan', text: 'daily plan', mode: 'send' },
  { label: '📊 Status', text: '/status', mode: 'send' },
  { label: '🔥 My Streak', text: 'my streak', mode: 'send' },
  { label: '🗳️ Vote', text: '/proposals', mode: 'send' },
  { label: '💸 Send Crypto', text: '__SEND_CRYPTO__', mode: 'special' },
  { label: '⚔️ Challenge', text: 'challenge a member', mode: 'send' },
  { label: '🎮 Play a Game', text: 'play a game', mode: 'send' },
  { label: '🧠 Trivia', text: 'trivia', mode: 'send' },
  { label: '🤔 Would You Rather', text: 'would you rather', mode: 'send' },
  { label: '🔥 Hot Take', text: 'hot take', mode: 'send' },
  { label: '🖥️ Step Away', text: '__STEP_AWAY__', mode: 'special' },
  { label: '>_ Help', text: '/help', mode: 'send' },
  { label: '☢️ Nuke Chat', text: '__NUKE__', mode: 'special' },
];

export const FEATURED_QUICK_ACTIONS = QUICK_PROMPTS.slice(0, 7);
export const ALL_QUICK_ACTIONS = QUICK_PROMPTS;

export const FEATURED_TOOL_ACTIONS: FeaturedToolAction[] = [
  { label: 'Image', text: '/imagine ', color: '#f43f5e', flatIcon: 'designer', mode: 'prefill' },
  { label: 'Speak', text: '/speak ', color: '#06b6d4', mode: 'prefill' },
  { label: 'Code', text: '/code ', color: '#22c55e', flatIcon: 'code', mode: 'prefill' },
  { label: 'WordPress', text: '/wp help', color: '#21759b', flatIcon: 'wordpress', mode: 'send' },
  { label: 'Summarize', text: '/summarize ', color: '#f59e0b', flatIcon: 'writer', mode: 'prefill' },
  { label: 'Translate', text: '/translate ', color: '#8b5cf6', mode: 'prefill' },
  { label: 'Build page', text: '/build-page ', color: '#3b82f6', flatIcon: 'architect', mode: 'prefill' },
  { label: 'Computer', text: '/browser plan ', color: '#14b8a6', mode: 'prefill' },
  { label: 'All tools', text: '/hf help', color: '#eab308', flatIcon: 'brain', mode: 'send' },
];

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
    color: '#22d3ee',
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

const QUICK_ACTION_OVERRIDES: Record<string, { mode: QuickActionMode; text: string }> = {
  '__tip__': { mode: 'special', text: '__TIP__' },
  '__send_crypto__': { mode: 'special', text: '__SEND_CRYPTO__' },
  '__check_in__': { mode: 'special', text: '__CHECK_IN__' },
  '__new_task__': { mode: 'special', text: '__NEW_TASK__' },
  '__step_away__': { mode: 'special', text: '__STEP_AWAY__' },
  '__assign_agent__': { mode: 'special', text: '__ASSIGN_AGENT__' },
  '__spawn_agent__': { mode: 'special', text: '__SPAWN_AGENT__' },
  '__computer_use__': { mode: 'special', text: '__COMPUTER_USE__' },
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

export function resolveQuickActionExecution(text: string): { mode: QuickActionMode; text: string } {
  const normalized = text.trim().toLowerCase();
  const override = QUICK_ACTION_OVERRIDES[normalized];
  if (override) return override;

  const action =
    QUICK_PROMPTS.find(item => item.text === text) ||
    FEATURED_TOOL_ACTIONS.find(item => item.text === text);
  const mode = action?.mode || (text.endsWith(' ') ? 'prefill' : 'send');
  return { mode, text };
}
