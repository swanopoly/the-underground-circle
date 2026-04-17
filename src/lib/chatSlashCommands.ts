export type ChatSlashCommandCategory =
  | 'general'
  | 'memory'
  | 'missions'
  | 'rooms'
  | 'github'
  | 'wordpress'
  | 'ai_tools'
  | 'governance'
  | 'knowledge';

export interface ChatSlashCommand {
  id: string;
  command: string;
  insertText: string;
  title: string;
  description: string;
  category: ChatSlashCommandCategory;
  aliases?: string[];
  keywords?: string[];
  showInHelp?: boolean;
}

export const CHAT_SLASH_COMMANDS: ChatSlashCommand[] = [
  {
    id: 'help',
    command: '/help',
    insertText: '/help',
    title: 'Help',
    description: 'Show all available chat commands.',
    category: 'general',
    aliases: ['/commands'],
    keywords: ['commands', 'list'],
  },
  {
    id: 'summary',
    command: '/summary',
    insertText: '/summary',
    title: 'Summary',
    description: 'Show the full circle status report.',
    category: 'general',
    aliases: ['/status'],
    keywords: ['report', 'circle', 'overview'],
  },
  {
    id: 'commands',
    command: '/commands',
    insertText: '/commands',
    title: 'Commands',
    description: 'Alias for command help.',
    category: 'general',
    aliases: ['/help'],
    keywords: ['help', 'list'],
  },
  {
    id: 'wiki',
    command: '/wiki',
    insertText: '/wiki ',
    title: 'Wiki Search',
    description: 'Search the internal AI wiki.',
    category: 'knowledge',
    keywords: ['knowledge', 'search', 'docs'],
  },
  {
    id: 'research',
    command: '/research',
    insertText: '/research ',
    title: 'Research Corpus',
    description: 'Search the curated research corpus.',
    category: 'knowledge',
    keywords: ['science', 'papers', 'research'],
  },
  {
    id: 'memories',
    command: '/memories',
    insertText: '/memories',
    title: 'Open Memories',
    description: 'Open the memory viewer.',
    category: 'memory',
    aliases: ['/memory'],
    keywords: ['viewer', 'saved'],
  },
  {
    id: 'remember',
    command: '/remember',
    insertText: '/remember ',
    title: 'Remember',
    description: 'Save something to memory.',
    category: 'memory',
    keywords: ['save', 'store'],
  },
  {
    id: 'forget',
    command: '/forget',
    insertText: '/forget ',
    title: 'Forget',
    description: 'Delete memories matching a keyword.',
    category: 'memory',
    keywords: ['delete', 'remove'],
  },
  {
    id: 'reasoning-standard',
    command: '/reasoning-standard',
    insertText: '/reasoning-standard',
    title: 'Reasoning Standard',
    description: 'Save your deep reasoning preference.',
    category: 'memory',
    aliases: ['/deep-reasoning'],
    keywords: ['reasoning', 'preference', 'depth'],
  },
  {
    id: 'mission',
    command: '/mission',
    insertText: '/mission',
    title: 'Mission Status',
    description: 'Show mission status and progress.',
    category: 'missions',
    keywords: ['tasks', 'goals'],
  },
  {
    id: 'mission-status',
    command: '/mission status',
    insertText: '/mission status',
    title: 'Mission Report',
    description: 'Show a detailed mission report.',
    category: 'missions',
    keywords: ['progress', 'report'],
  },
  {
    id: 'mission-create',
    command: '/mission create',
    insertText: '/mission create ',
    title: 'Create Mission',
    description: 'Create a new mission.',
    category: 'missions',
    keywords: ['new', 'goal'],
  },
  {
    id: 'mission-complete',
    command: '/mission complete',
    insertText: '/mission complete',
    title: 'Complete Mission',
    description: 'Mark the latest mission complete.',
    category: 'missions',
    keywords: ['done', 'finish'],
  },
  {
    id: 'mission-help',
    command: '/mission help',
    insertText: '/mission help',
    title: 'Mission Help',
    description: 'Show mission command help.',
    category: 'missions',
    keywords: ['docs', 'guide'],
  },
  {
    id: 'room',
    command: '/room',
    insertText: '/room ',
    title: 'Room Command',
    description: 'Run a room command.',
    category: 'rooms',
    keywords: ['files', 'project'],
  },
  {
    id: 'room-list',
    command: '/room list',
    insertText: '/room list',
    title: 'List Rooms',
    description: 'List project rooms.',
    category: 'rooms',
    keywords: ['projects', 'rooms'],
  },
  {
    id: 'room-ls',
    command: '/room ls',
    insertText: '/room ls',
    title: 'List Rooms Alias',
    description: 'Alias for listing rooms.',
    category: 'rooms',
    keywords: ['list', 'rooms'],
  },
  {
    id: 'room-files',
    command: '/room files',
    insertText: '/room files ',
    title: 'List Room Files',
    description: 'List files in a room.',
    category: 'rooms',
    keywords: ['browse', 'files'],
  },
  {
    id: 'room-read',
    command: '/room read',
    insertText: '/room read ',
    title: 'Read Room File',
    description: 'Alias for reading a room file.',
    category: 'rooms',
    keywords: ['cat', 'show', 'file'],
  },
  {
    id: 'room-show',
    command: '/room show',
    insertText: '/room show ',
    title: 'Show Room File',
    description: 'Alias for showing a room file.',
    category: 'rooms',
    keywords: ['cat', 'read', 'file'],
  },
  {
    id: 'room-cat',
    command: '/room cat',
    insertText: '/room cat ',
    title: 'Read Room File',
    description: 'Show room file contents.',
    category: 'rooms',
    keywords: ['read', 'show', 'file'],
  },
  {
    id: 'room-help',
    command: '/room help',
    insertText: '/room help',
    title: 'Room Help',
    description: 'Show room command help.',
    category: 'rooms',
    keywords: ['docs', 'guide'],
  },
  {
    id: 'gh',
    command: '/gh',
    insertText: '/gh ',
    title: 'GitHub Command',
    description: 'Run a GitHub command.',
    category: 'github',
    keywords: ['repo', 'pull request', 'code'],
  },
  {
    id: 'gh-status',
    command: '/gh status',
    insertText: '/gh status',
    title: 'GitHub Status',
    description: 'Show connected repos and activity.',
    category: 'github',
    keywords: ['repos', 'activity'],
  },
  {
    id: 'gh-tree',
    command: '/gh tree',
    insertText: '/gh tree',
    title: 'Repo Tree',
    description: 'Show the repo file tree.',
    category: 'github',
    keywords: ['files', 'tree'],
  },
  {
    id: 'gh-cat',
    command: '/gh cat',
    insertText: '/gh cat ',
    title: 'Read GitHub File',
    description: 'Show file contents from the repo.',
    category: 'github',
    keywords: ['read', 'file'],
  },
  {
    id: 'gh-edit',
    command: '/gh edit',
    insertText: '/gh edit ',
    title: 'Edit GitHub File',
    description: 'Start editing a repo file.',
    category: 'github',
    keywords: ['file', 'modify'],
  },
  {
    id: 'gh-save',
    command: '/gh save',
    insertText: '/gh save ',
    title: 'Save GitHub File',
    description: 'Save or create a repo file.',
    category: 'github',
    keywords: ['file', 'create', 'write'],
  },
  {
    id: 'gh-branch',
    command: '/gh branch',
    insertText: '/gh branch ',
    title: 'Create Branch',
    description: 'Create a new branch.',
    category: 'github',
    keywords: ['git', 'branch'],
  },
  {
    id: 'gh-branches',
    command: '/gh branches',
    insertText: '/gh branches',
    title: 'List Branches',
    description: 'List repo branches.',
    category: 'github',
    keywords: ['git', 'branch', 'list'],
  },
  {
    id: 'gh-pr',
    command: '/gh pr',
    insertText: '/gh pr ',
    title: 'Create Pull Request',
    description: 'Create a pull request.',
    category: 'github',
    keywords: ['pull request', 'review'],
  },
  {
    id: 'gh-commits',
    command: '/gh commits',
    insertText: '/gh commits',
    title: 'Recent Commits',
    description: 'List recent commits.',
    category: 'github',
    keywords: ['history', 'changes'],
  },
  {
    id: 'gh-diff',
    command: '/gh diff',
    insertText: '/gh diff ',
    title: 'Compare Branches',
    description: 'Compare two branches.',
    category: 'github',
    keywords: ['compare', 'changes'],
  },
  {
    id: 'gh-prs',
    command: '/gh prs',
    insertText: '/gh prs',
    title: 'Pull Requests',
    description: 'List open pull requests.',
    category: 'github',
    keywords: ['pr', 'review'],
  },
  {
    id: 'gh-help',
    command: '/gh help',
    insertText: '/gh help',
    title: 'GitHub Help',
    description: 'Show GitHub command help.',
    category: 'github',
    keywords: ['docs', 'guide'],
  },
  {
    id: 'wp',
    command: '/wp',
    insertText: '/wp ',
    title: 'WordPress Command',
    description: 'Run a WordPress command.',
    category: 'wordpress',
    keywords: ['cms', 'publish', 'site'],
  },
  {
    id: 'wp-status',
    command: '/wp status',
    insertText: '/wp status',
    title: 'WordPress Status',
    description: 'Show WordPress site connection status.',
    category: 'wordpress',
    keywords: ['site', 'connected'],
  },
  {
    id: 'wp-info',
    command: '/wp info',
    insertText: '/wp info',
    title: 'WordPress Site Info',
    description: 'Alias for WordPress status.',
    category: 'wordpress',
    keywords: ['status', 'site'],
  },
  {
    id: 'wp-list',
    command: '/wp list',
    insertText: '/wp list',
    title: 'List WordPress Posts',
    description: 'List recent posts.',
    category: 'wordpress',
    keywords: ['posts', 'content'],
  },
  {
    id: 'wp-pages',
    command: '/wp pages',
    insertText: '/wp pages',
    title: 'List WordPress Pages',
    description: 'List pages on the site.',
    category: 'wordpress',
    keywords: ['pages', 'content'],
  },
  {
    id: 'wp-get',
    command: '/wp get',
    insertText: '/wp get ',
    title: 'Get WordPress Post',
    description: 'Fetch a post by ID.',
    category: 'wordpress',
    keywords: ['post', 'read'],
  },
  {
    id: 'wp-write',
    command: '/wp write',
    insertText: '/wp write ',
    title: 'Write WordPress Post',
    description: 'Generate and draft a full blog post.',
    category: 'wordpress',
    keywords: ['blog', 'draft', 'content'],
  },
  {
    id: 'wp-draft',
    command: '/wp draft',
    insertText: '/wp draft ',
    title: 'Draft WordPress Post',
    description: 'Create a draft post.',
    category: 'wordpress',
    keywords: ['post', 'draft'],
  },
  {
    id: 'wp-publish',
    command: '/wp publish',
    insertText: '/wp publish ',
    title: 'Publish WordPress Post',
    description: 'Publish a drafted post.',
    category: 'wordpress',
    keywords: ['post', 'publish'],
  },
  {
    id: 'wp-schedule',
    command: '/wp schedule',
    insertText: '/wp schedule ',
    title: 'Schedule WordPress Post',
    description: 'Schedule a post for later publishing.',
    category: 'wordpress',
    keywords: ['publish', 'calendar'],
  },
  {
    id: 'wp-edit',
    command: '/wp edit',
    insertText: '/wp edit ',
    title: 'Edit WordPress Post',
    description: 'Edit an existing post.',
    category: 'wordpress',
    keywords: ['post', 'update'],
  },
  {
    id: 'wp-delete',
    command: '/wp delete',
    insertText: '/wp delete ',
    title: 'Delete WordPress Post',
    description: 'Move a post to trash.',
    category: 'wordpress',
    keywords: ['trash', 'remove'],
  },
  {
    id: 'wp-image',
    command: '/wp image',
    insertText: '/wp image ',
    title: 'Set Featured Image',
    description: 'Set a post featured image.',
    category: 'wordpress',
    keywords: ['featured', 'media'],
  },
  {
    id: 'wp-categories',
    command: '/wp categories',
    insertText: '/wp categories',
    title: 'List Categories',
    description: 'List WordPress categories.',
    category: 'wordpress',
    keywords: ['taxonomy', 'content'],
  },
  {
    id: 'wp-tags',
    command: '/wp tags',
    insertText: '/wp tags',
    title: 'List Tags',
    description: 'List WordPress tags.',
    category: 'wordpress',
    keywords: ['taxonomy', 'content'],
  },
  {
    id: 'wp-help',
    command: '/wp help',
    insertText: '/wp help',
    title: 'WordPress Help',
    description: 'Show WordPress command help.',
    category: 'wordpress',
    keywords: ['docs', 'guide'],
  },
  {
    id: 'summarize',
    command: '/summarize',
    insertText: '/summarize ',
    title: 'Summarize',
    description: 'Summarize text or a URL.',
    category: 'ai_tools',
    keywords: ['summary', 'text'],
  },
  {
    id: 'translate',
    command: '/translate',
    insertText: '/translate ',
    title: 'Translate',
    description: 'Translate text.',
    category: 'ai_tools',
    keywords: ['language'],
  },
  {
    id: 'classify',
    command: '/classify',
    insertText: '/classify ',
    title: 'Classify',
    description: 'Classify text into categories.',
    category: 'ai_tools',
    keywords: ['labels'],
  },
  {
    id: 'zero-shot',
    command: '/zero-shot',
    insertText: '/zero-shot ',
    title: 'Zero Shot',
    description: 'Run zero-shot classification.',
    category: 'ai_tools',
    keywords: ['labels', 'classification'],
  },
  {
    id: 'qa',
    command: '/qa',
    insertText: '/qa ',
    title: 'Question Answering',
    description: 'Ask a question against provided context.',
    category: 'ai_tools',
    keywords: ['answer', 'context'],
  },
  {
    id: 'imagine',
    command: '/imagine',
    insertText: '/imagine ',
    title: 'Generate Image',
    description: 'Generate an image.',
    category: 'ai_tools',
    keywords: ['image', 'art'],
  },
  {
    id: 'vision',
    command: '/vision',
    insertText: '/vision ',
    title: 'Vision',
    description: 'Analyze an image or visual input.',
    category: 'ai_tools',
    keywords: ['image', 'analyze'],
  },
  {
    id: 'openmodel',
    command: '/openmodel',
    insertText: '/openmodel ',
    title: 'Open Model',
    description: 'Run a direct open-model prompt.',
    category: 'ai_tools',
    keywords: ['model'],
  },
  {
    id: 'build-page',
    command: '/build-page',
    insertText: '/build-page ',
    title: 'Build Page',
    description: 'Generate a webpage.',
    category: 'ai_tools',
    keywords: ['html', 'web'],
  },
  {
    id: 'code',
    command: '/code',
    insertText: '/code ',
    title: 'Code',
    description: 'Generate code from a prompt.',
    category: 'ai_tools',
    keywords: ['programming', 'build'],
  },
  {
    id: 'speak',
    command: '/speak',
    insertText: '/speak ',
    title: 'Speak',
    description: 'Convert text to speech.',
    category: 'ai_tools',
    keywords: ['audio', 'tts'],
  },
  {
    id: 'hf-help',
    command: '/hf help',
    insertText: '/hf help',
    title: 'AI Tools Help',
    description: 'Show AI tools help.',
    category: 'ai_tools',
    aliases: ['/hf'],
    keywords: ['hugging face', 'tools', 'guide'],
  },
  {
    id: 'vote',
    command: '/vote',
    insertText: '/vote',
    title: 'Vote Alias',
    description: 'Alias for active proposals.',
    category: 'governance',
    aliases: ['/proposals'],
    keywords: ['proposal', 'poll'],
  },
  {
    id: 'votes',
    command: '/votes',
    insertText: '/votes',
    title: 'Votes Alias',
    description: 'Alias for active proposals.',
    category: 'governance',
    aliases: ['/proposals'],
    keywords: ['proposal', 'poll'],
  },
  {
    id: 'poll',
    command: '/poll',
    insertText: '/poll ',
    title: 'Create Poll',
    description: 'Create a quick poll.',
    category: 'governance',
    keywords: ['vote', 'proposal'],
  },
  {
    id: 'propose',
    command: '/propose',
    insertText: '/propose ',
    title: 'Create Proposal',
    description: 'Create a governance proposal.',
    category: 'governance',
    keywords: ['vote', 'dao'],
  },
  {
    id: 'proposals',
    command: '/proposals',
    insertText: '/proposals',
    title: 'Active Proposals',
    description: 'Show active proposals and polls.',
    category: 'governance',
    aliases: ['/vote', '/votes'],
    keywords: ['governance', 'polls'],
  },
  {
    id: 'pin',
    command: '/pin',
    insertText: '/pin',
    title: 'Pin Message',
    description: 'Pin the latest eligible message.',
    category: 'governance',
    keywords: ['important'],
  },
  {
    id: 'pins',
    command: '/pins',
    insertText: '/pins',
    title: 'Pinned Messages',
    description: 'Show pinned messages.',
    category: 'governance',
    aliases: ['/pinned'],
    keywords: ['important'],
  },
  {
    id: 'search',
    command: '/search',
    insertText: '/search ',
    title: 'Search Chat',
    description: 'Search chat history.',
    category: 'governance',
    keywords: ['messages', 'history'],
  },
];

const CATEGORY_LABELS: Record<ChatSlashCommandCategory, string> = {
  general: 'General',
  memory: 'Memory',
  missions: 'Missions',
  rooms: 'Rooms',
  github: 'GitHub',
  wordpress: 'WordPress',
  ai_tools: 'AI Tools',
  governance: 'Governance',
  knowledge: 'Knowledge',
};

export function getChatSlashCategoryLabel(category: ChatSlashCommandCategory): string {
  return CATEGORY_LABELS[category];
}

const HELP_CATEGORY_ORDER: ChatSlashCommandCategory[] = [
  'general',
  'knowledge',
  'memory',
  'missions',
  'rooms',
  'github',
  'wordpress',
  'ai_tools',
  'governance',
];

export function buildChatSlashHelpMessage(): string {
  const lines: string[] = ['**Available Commands**', ''];

  for (const category of HELP_CATEGORY_ORDER) {
    const commands = CHAT_SLASH_COMMANDS
      .filter((entry) => entry.category === category && entry.showInHelp !== false)
      .filter((entry, index, arr) => arr.findIndex((candidate) => candidate.command === entry.command) === index);

    if (commands.length === 0) continue;

    lines.push(`**${CATEGORY_LABELS[category]}**`);
    for (const command of commands) {
      lines.push(`\`${command.command}\` — ${command.description}`);
    }
    lines.push('');
  }

  lines.push(`\`@openswan <message>\` — talk to OpenSwan directly`);
  return lines.join('\n');
}

export function getMatchingChatSlashCommands(input: string): ChatSlashCommand[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return [];

  const firstToken = trimmed.split(/\s+/, 1)[0] || '';
  if (!firstToken.startsWith('/')) return [];

  const query = firstToken.slice(1).toLowerCase();
  const normalizedQuery = query.replace(/\s+/g, '');

  const matches = CHAT_SLASH_COMMANDS.filter((entry) => {
    if (!normalizedQuery) return true;
    const haystacks = [
      entry.command,
      entry.title,
      entry.description,
      ...(entry.aliases || []),
      ...(entry.keywords || []),
    ].map((value) => value.toLowerCase());

    return haystacks.some((value) => value.replace(/^[\\/]/, '').includes(normalizedQuery));
  });

  return matches.sort((a, b) => {
    const aExact = a.command.slice(1).startsWith(normalizedQuery) ? 0 : 1;
    const bExact = b.command.slice(1).startsWith(normalizedQuery) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.command.localeCompare(b.command);
  });
}
