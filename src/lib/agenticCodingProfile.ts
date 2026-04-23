export type AgenticCodingSurface = 'main_chat' | 'room_chat';
export type AgenticCodingProfile = 'senior' | 'review' | 'debug' | 'architect' | 'research' | 'design' | 'support';

// ── Weighted intent detection ─────────────────────────────────────────────
// Each category has signal patterns with weights. The highest-scoring wins.
// Uses additive scoring so overlapping intents resolve correctly.

type Signal = { re: RegExp; weight: number };

// ── Profile signals (which SOUL drives the response) ──────────────────────

const DEBUG_SIGNALS: Signal[] = [
  { re: /\b(debug|debugging)\b/i, weight: 5 },
  { re: /\b(bug|bugs|bugfix)\b/i, weight: 5 },
  { re: /\b(fix|fixing)\b.*\b(this|the|that|it|my)\b/i, weight: 4 },
  { re: /\b(broken|not working|doesn't work|doesn't work|won't work|stopped working|can't|cannot)\b/i, weight: 5 },
  { re: /\b(error|errors|exception|exceptions|crash|crashes|crashing)\b/i, weight: 5 },
  { re: /\b(trace|traceback|stack trace|stacktrace)\b/i, weight: 5 },
  { re: /\b(regression|regressed)\b/i, weight: 4 },
  { re: /\b(failing|fails|fail)\b/i, weight: 3 },
  { re: /\b(undefined|null|NaN|TypeError|ReferenceError|SyntaxError)\b/i, weight: 4 },
  { re: /\bwhy\s+(is|does|did|are|do)\b.*\b(not|broken|wrong|fail)/i, weight: 4 },
  { re: /\b(unexpected|wrong|incorrect|weird)\b.*\b(behavior|result|output|value)\b/i, weight: 3 },
  { re: /\b(console\.log|console\.error|logs?\s+show)\b/i, weight: 3 },
  { re: /\b(404|500|502|503|ECONNREFUSED|CORS|timeout)\b/i, weight: 4 },
  { re: /\b(white\s*screen|blank\s*page|infinite\s*loop|memory\s*leak)\b/i, weight: 4 },
];

const REVIEW_SIGNALS: Signal[] = [
  { re: /\b(review|reviewing|code\s*review)\b/i, weight: 5 },
  { re: /\b(audit|auditing)\b/i, weight: 5 },
  { re: /\b(check|inspect|scan|analyze|assess|critique|evaluate)\b.*\b(code|files?|this|the|my|our|it)\b/i, weight: 4 },
  { re: /\b(look\s+over|look\s+at|go\s+through|walk\s+through)\b/i, weight: 3 },
  { re: /\b(security|vulnerab|owasp|xss|injection|auth.*flaw)\b/i, weight: 4 },
  { re: /\b(code\s*quality|tech\s*debt|clean\s*up|refactor)\b/i, weight: 3 },
  { re: /\b(test\s*coverage|missing\s*tests|test\s*gaps)\b/i, weight: 3 },
  { re: /\b(performance|perf|optimize|slow|latency)\b.*\b(review|check|audit|issue)\b/i, weight: 3 },
  { re: /\b(type\s*error|typescript|tsc|typecheck)\b/i, weight: 2 },
  { re: /\bPR\b|\bpull\s*request\b/i, weight: 3 },
  { re: /\b(what\s+do\s+you\s+think|feedback|opinion|thoughts)\b/i, weight: 2 },
  { re: /\b(diff|changeset|changes)\b/i, weight: 2 },
];

const ARCHITECT_SIGNALS: Signal[] = [
  { re: /\b(architect|architecture|system\s*design)\b/i, weight: 5 },
  { re: /\b(design\s*pattern|structure|restructure|boundaries|bounded\s*context)\b/i, weight: 4 },
  { re: /\b(dependency|coupling|decoupling|modular|monolith|microservice)\b/i, weight: 4 },
  { re: /\b(trade-?off|tradeoff|pros?\s+and\s+cons?)\b/i, weight: 3 },
  { re: /\b(should\s+we|should\s+I|what\s+approach|best\s+way\s+to|how\s+should)\b/i, weight: 2 },
  { re: /\b(scaling|scale|migration|migrate)\b/i, weight: 2 },
  { re: /\b(split|separate|extract|abstract|layer)\b.*\b(into|from|out)\b/i, weight: 3 },
  { re: /\b(plan|planning|strategy|roadmap|RFC)\b/i, weight: 2 },
  { re: /\b(integrate|integration|API\s*design|schema\s*design|data\s*model)\b/i, weight: 2 },
  { re: /\b(event\s*sourcing|CQRS|saga|domain\s*driven)\b/i, weight: 4 },
];

const BUILD_SIGNALS: Signal[] = [
  { re: /\b(build|implement|ship|create|add|generate|make|write|code)\b/i, weight: 3 },
  { re: /\b(component|screen|page|feature|endpoint|api|function|class|module|hook)\b/i, weight: 2 },
  { re: /\b(landing\s*page|dashboard|form|modal|panel|tab|widget)\b/i, weight: 3 },
  { re: /\b(wire\s*up|hook\s*up|connect|integrate)\b/i, weight: 2 },
  { re: /\b(html|css|react|typescript|javascript|python|sql)\b/i, weight: 1 },
  { re: /\b(deploy|publish|push|release)\b/i, weight: 2 },
  { re: /\b(can\s+you|please|I\s+need|I\s+want)\b.*\b(build|create|make|add|write)\b/i, weight: 3 },
  { re: /\b(scaffold|boilerplate|starter|template|setup)\b/i, weight: 3 },
  { re: /\b(test|spec|unit\s*test|integration\s*test)\b.*\b(for|write|add|create)\b/i, weight: 3 },
];

function scoreProfile(message: string, signals: Signal[]): number {
  let score = 0;
  for (const { re, weight } of signals) {
    if (re.test(message)) score += weight;
  }
  return score;
}

export function detectAgenticCodingProfile(message: string, surface: AgenticCodingSurface): AgenticCodingProfile {
  if (surface === 'room_chat') return 'review';

  const scores: Record<AgenticCodingProfile, number> = {
    debug: scoreProfile(message, DEBUG_SIGNALS),
    review: scoreProfile(message, REVIEW_SIGNALS),
    architect: scoreProfile(message, ARCHITECT_SIGNALS),
    senior: scoreProfile(message, BUILD_SIGNALS),
    research: 0,
    design: 0,
    support: 0,
  };

  const ranked: AgenticCodingProfile[] = ['debug', 'review', 'architect', 'senior'];
  let best: AgenticCodingProfile = 'senior';
  let bestScore = 0;
  for (const profile of ranked) {
    if (scores[profile] > bestScore) {
      bestScore = scores[profile];
      best = profile;
    }
  }

  if (bestScore < 2) return 'senior';
  return best;
}

// ── Smart routing ─────────────────────────────────────────────────────────
// Determines complexity, chat mode, delegation, and context budget for
// every kind of message the user might send.

export type MessageComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';
type RecommendedDelegation = 'focused' | 'auto' | 'parallel';

// ── Intent categories (broader than just coding profiles) ─────────────────
// These cover the full range of messages: casual, Q&A, research, tasks,
// creative work, operational, and coding. Each maps to a chat mode.

export type MessageIntent =
  | 'casual'      // greetings, thanks, affirmations
  | 'question'    // factual Q&A, explanations, "what is X"
  | 'research'    // deep dives, comparisons, investigations
  | 'task_mgmt'   // CRUD on tasks, goals, missions, scheduling
  | 'build'       // implement features, write code, ship
  | 'debug'       // fix bugs, trace errors
  | 'review'      // audit code, PRs, security
  | 'architect'   // design, plan, structure
  | 'design'      // UI/UX, visual, landing pages, branding
  | 'support'     // help with the app, troubleshoot setup
  | 'memory'      // remember, forget, recall, what do we know
  | 'browser'     // navigate sites, fill forms, scrape
  | 'creative'    // write content, blog posts, copy, docs
  | 'status'      // check progress, streaks, what's happening
  | 'social';     // polls, games, fun, hot takes

const INTENT_SIGNALS: Record<MessageIntent, Signal[]> = {
  casual: [
    { re: /^(hi|hey|hello|yo|sup|what'?s up|good morning|good evening|gm|gn|morning|evening)\b/i, weight: 6 },
    { re: /^(thanks|thank you|ty|thx|cool|nice|ok|okay|got it|understood|makes sense|perfect|great|awesome)\b/i, weight: 6 },
    { re: /^(yes|no|yep|nope|yeah|nah|sure|definitely|absolutely|right|true|exactly)\b/i, weight: 5 },
    { re: /^(lol|haha|lmao|rofl|bruh|bro|dude|man|damn|wow|wtf|omg)\b/i, weight: 5 },
    { re: /^.{1,8}$/i, weight: 3 }, // very short messages
  ],
  question: [
    { re: /\b(what\s+is|what\s+are|what\s+does|what\s+do)\b/i, weight: 4 },
    { re: /\b(explain|tell\s+me\s+about|describe|define|meaning\s+of)\b/i, weight: 4 },
    { re: /\b(how\s+does|how\s+do|how\s+to|how\s+can|how\s+would)\b/i, weight: 3 },
    { re: /\b(when\s+did|when\s+does|when\s+should|where\s+is|where\s+do)\b/i, weight: 3 },
    { re: /\b(who\s+is|who\s+are|who\s+created|who\s+made)\b/i, weight: 3 },
    { re: /\b(can\s+you\s+explain|give\s+me\s+an?\s+example|ELI5|in\s+simple\s+terms)\b/i, weight: 4 },
    { re: /\?$/, weight: 2 },
  ],
  research: [
    { re: /\b(research|investigate|deep\s*dive|exploration|study|survey)\b/i, weight: 5 },
    { re: /\b(compare|comparison|versus|vs\.?|alternatives|options|which\s+is\s+better)\b/i, weight: 4 },
    { re: /\b(trade-?offs?|tradeoffs?|pros?\s+and\s+cons?|advantages|disadvantages)\b/i, weight: 4 },
    { re: /\b(best\s+practices?|state\s+of\s+the\s+art|latest|current\s+state)\b/i, weight: 3 },
    { re: /\b(benchmark|evaluation|analysis|findings|report)\b/i, weight: 3 },
    { re: /\b(landscape|ecosystem|market|competitors?|competitive)\b/i, weight: 3 },
    { re: /\b(what\s+are\s+the\s+options|what\s+are\s+my\s+options|explore)\b/i, weight: 3 },
  ],
  task_mgmt: [
    { re: /\b(list|show|check|get)\b.*\b(tasks?|todos?|tickets?|issues?|backlog)\b/i, weight: 5 },
    { re: /\b(create|add|make|open|new)\b.*\b(task|todo|ticket|issue)\b/i, weight: 5 },
    { re: /\b(update|move|change|set)\b.*\b(task|status|priority|assignee)\b/i, weight: 5 },
    { re: /\b(assign|reassign|delegate)\b.*\b(to|task)\b/i, weight: 4 },
    { re: /\b(complete|done|finish|close|resolve)\b.*\b(task|ticket|issue)\b/i, weight: 4 },
    { re: /\b(list|show|check)\b.*\b(goals?|missions?|okrs?|objectives?)\b/i, weight: 5 },
    { re: /\b(create|add|start)\b.*\b(goal|mission|sprint)\b/i, weight: 5 },
    { re: /\b(schedule|automate|remind|cron|recurring|every\s+(day|week|month|hour))\b/i, weight: 5 },
    { re: /\b(kanban|board|backlog|in\s*progress|sprint)\b/i, weight: 3 },
  ],
  build: [
    { re: /\b(build|implement|ship|create|add|generate|write|code|scaffold)\b.*\b(a |the |this |my |new |an? )/i, weight: 5 },
    { re: /\b(component|screen|page|feature|endpoint|api|function|class|module|hook)\b/i, weight: 3 },
    { re: /\b(wire\s*up|hook\s*up|connect|set\s*up|configure)\b/i, weight: 3 },
    { re: /\b(deploy|publish|push|release|launch)\b/i, weight: 3 },
    { re: /\b(test|spec|unit\s*test)\b.*\b(for|write|add|create)\b/i, weight: 3 },
    { re: /\b(boilerplate|starter|template|setup|init)\b/i, weight: 3 },
    { re: /\b(refactor|rewrite|rebuild|overhaul)\b/i, weight: 3 },
  ],
  debug: [
    { re: /\b(debug|debugging)\b/i, weight: 5 },
    { re: /\b(bug|bugs|bugfix)\b/i, weight: 5 },
    { re: /\b(fix|fixing)\b.*\b(this|the|that|it|my|a)\b/i, weight: 4 },
    { re: /\b(broken|not\s+working|doesn't\s+work|won't\s+work|stopped\s+working)\b/i, weight: 5 },
    { re: /\b(error|errors|exception|crash|crashing)\b/i, weight: 5 },
    { re: /\b(trace|traceback|stack\s*trace)\b/i, weight: 5 },
    { re: /\b(undefined|null|NaN|TypeError|ReferenceError|SyntaxError)\b/i, weight: 4 },
    { re: /\b(404|500|502|503|ECONNREFUSED|CORS|timeout)\b/i, weight: 4 },
    { re: /\b(white\s*screen|blank\s*page|infinite\s*loop|memory\s*leak)\b/i, weight: 4 },
    { re: /\b(regression|regressed|broke|breaking)\b/i, weight: 4 },
  ],
  review: [
    { re: /\b(review|reviewing|code\s*review)\b/i, weight: 5 },
    { re: /\b(audit|auditing)\b/i, weight: 5 },
    { re: /\b(check|inspect|scan|analyze|assess|critique)\b.*\b(code|files?|this|the|my|our)\b/i, weight: 4 },
    { re: /\b(look\s+over|go\s+through|walk\s+through)\b/i, weight: 3 },
    { re: /\b(security|vulnerab|owasp|xss|injection)\b/i, weight: 4 },
    { re: /\b(code\s*quality|tech\s*debt|clean\s*up)\b/i, weight: 3 },
    { re: /\bPR\b|\bpull\s*request\b/i, weight: 4 },
    { re: /\b(diff|changeset|what\s+changed)\b/i, weight: 3 },
  ],
  architect: [
    { re: /\b(architect|architecture|system\s*design)\b/i, weight: 5 },
    { re: /\b(design\s*pattern|structure|restructure|boundaries)\b/i, weight: 4 },
    { re: /\b(dependency|coupling|decoupling|modular|monolith|microservice)\b/i, weight: 4 },
    { re: /\b(should\s+we|should\s+I|what\s+approach|best\s+way\s+to|how\s+should)\b/i, weight: 3 },
    { re: /\b(plan|planning|strategy|roadmap|RFC|ADR)\b/i, weight: 3 },
    { re: /\b(split|separate|extract|abstract|layer)\b.*\b(into|from|out)\b/i, weight: 3 },
    { re: /\b(scaling|scale|migration|migrate|data\s*model|schema\s*design)\b/i, weight: 3 },
  ],
  design: [
    { re: /\b(design|redesign|mockup|mock-?up|wireframe|prototype)\b/i, weight: 4 },
    { re: /\b(UI|UX|user\s*interface|user\s*experience|visual|aesthetic)\b/i, weight: 4 },
    { re: /\b(landing\s*page|homepage|hero\s*section|website|web\s*page)\b/i, weight: 4 },
    { re: /\b(color|font|typography|layout|spacing|grid|responsive)\b/i, weight: 3 },
    { re: /\b(brand|branding|logo|identity|style\s*guide)\b/i, weight: 4 },
    { re: /\b(figma|framer|tailwind|css|animation|transition)\b/i, weight: 2 },
    { re: /\b(make\s+it\s+look|make\s+it\s+pretty|beautif|polish|clean\s*er)\b/i, weight: 3 },
    { re: /\b(dark\s*mode|light\s*mode|theme|palette)\b/i, weight: 3 },
  ],
  support: [
    { re: /\b(help|how\s+do\s+I|how\s+to|can\s+I|is\s+there\s+a\s+way)\b/i, weight: 3 },
    { re: /\b(setup|install|configure|connect|enable|disable|turn\s+on|turn\s+off)\b/i, weight: 3 },
    { re: /\b(where\s+is|where\s+do\s+I\s+find|how\s+do\s+I\s+access|can't\s+find)\b/i, weight: 4 },
    { re: /\b(docs|documentation|guide|tutorial|getting\s+started)\b/i, weight: 3 },
    { re: /\b(onboarding|getting\s+started|first\s+time|new\s+to)\b/i, weight: 3 },
    { re: /\b(invite|join|share|connect|link|webhook|api\s*key|token)\b/i, weight: 2 },
    { re: /\b(troubleshoot|troubleshooting|diagnose|issue\s+with|problem\s+with)\b/i, weight: 3 },
  ],
  memory: [
    { re: /\b(remember|save|store|note|pin)\b.*\b(this|that|the)\b/i, weight: 5 },
    { re: /\b(forget|delete|remove|clear)\b.*\b(memor|that|this|the)\b/i, weight: 5 },
    { re: /\b(what\s+do\s+you\s+(know|remember)|recall|memories)\b/i, weight: 5 },
    { re: /\b(what\s+did\s+we\s+(decide|discuss|agree|talk\s+about))\b/i, weight: 4 },
    { re: /\b(previous\s+session|last\s+time|earlier|before)\b/i, weight: 2 },
    { re: /\b(preference|preferences|always\s+use|never\s+use|from\s+now\s+on)\b/i, weight: 3 },
  ],
  browser: [
    { re: /\b(browser|browse|navigate|open\s+url|visit|go\s+to)\b/i, weight: 4 },
    { re: /\b(click|fill\s+out|fill\s+in|submit|login\s+to|sign\s+in)\b/i, weight: 4 },
    { re: /\b(scrape|extract|grab|pull)\b.*\b(from|data|page|site)\b/i, weight: 4 },
    { re: /\b(screenshot|capture|snapshot)\b/i, weight: 3 },
    { re: /\b(browserbase|stagehand|playwright|puppeteer|selenium)\b/i, weight: 5 },
    { re: /\b(computer[\s-]?use|web\s*agent)\b/i, weight: 5 },
    { re: /\b(fetch|read|get)\b.*\b(url|link|page|site|website)\b/i, weight: 3 },
  ],
  creative: [
    { re: /\b(write|draft|compose)\b.*\b(blog|post|article|email|copy|content|doc)\b/i, weight: 5 },
    { re: /\b(blog\s*post|newsletter|announcement|press\s*release)\b/i, weight: 4 },
    { re: /\b(summarize|summary|recap|digest|tldr|tl;?dr)\b/i, weight: 3 },
    { re: /\b(rewrite|edit|proofread|improve)\b.*\b(this|the|my|copy|text|content)\b/i, weight: 3 },
    { re: /\b(tweet|thread|linkedin|social\s*media|caption)\b/i, weight: 4 },
    { re: /\b(wordpress|wp|publish|post\s+to)\b/i, weight: 3 },
    { re: /\b(documentation|readme|changelog|release\s*notes)\b/i, weight: 3 },
  ],
  status: [
    { re: /\b(status|progress|update|what'?s\s+(happening|going\s+on|new|up))\b/i, weight: 4 },
    { re: /\b(streak|streaks|check-?in|checked\s+in)\b/i, weight: 4 },
    { re: /\b(how\s+are\s+we\s+doing|how'?s\s+the\s+team|team\s+status|who\s+shipped)\b/i, weight: 4 },
    { re: /\b(leaderboard|ranking|xp|points|badges|rewards)\b/i, weight: 4 },
    { re: /\b(analytics|metrics|stats|dashboard|usage)\b/i, weight: 3 },
    { re: /\b(activity|recent|latest|today|this\s+week)\b/i, weight: 2 },
  ],
  social: [
    { re: /\b(poll|vote|survey)\b/i, weight: 5 },
    { re: /\b(game|play|trivia|quiz)\b/i, weight: 5 },
    { re: /\b(hot\s+take|roast|challenge|dare|icebreaker)\b/i, weight: 5 },
    { re: /\b(would\s+you\s+rather|two\s+truths|confess|shoutout)\b/i, weight: 5 },
    { re: /\b(fun|funny|joke|meme|lol)\b/i, weight: 2 },
    { re: /\b(team\s+bonding|celebration|celebrate|mvp|kudos|props)\b/i, weight: 3 },
  ],
};

// ── Intent → chat mode mapping ────────────────────────────────────────────

const INTENT_TO_CHAT_MODE: Record<MessageIntent, string> = {
  casual: 'none',
  question: 'none',      // simple Q&A stays fast
  research: 'research',
  task_mgmt: 'build',    // needs tool access
  build: 'build',
  debug: 'build',
  review: 'review',
  architect: 'plan',
  design: 'design',
  support: 'support',
  memory: 'none',        // handled by slash commands / conversational router
  browser: 'execute',
  creative: 'build',
  status: 'none',        // fast path, data queries
  social: 'none',        // fun stuff stays lightweight
};

const INTENT_TO_PROFILE: Record<MessageIntent, AgenticCodingProfile> = {
  casual: 'senior',
  question: 'senior',
  research: 'research',
  task_mgmt: 'senior',
  build: 'senior',
  debug: 'debug',
  review: 'review',
  architect: 'architect',
  design: 'design',
  support: 'support',
  memory: 'senior',
  browser: 'senior',
  creative: 'senior',
  status: 'senior',
  social: 'senior',
};

const INTENT_LABELS: Record<MessageIntent, string> = {
  casual: 'CHAT',
  question: 'Q&A',
  research: 'RESEARCH',
  task_mgmt: 'TASKS',
  build: 'BUILD',
  debug: 'DEBUG',
  review: 'REVIEW',
  architect: 'ARCH',
  design: 'DESIGN',
  support: 'HELP',
  memory: 'MEMORY',
  browser: 'BROWSER',
  creative: 'WRITE',
  status: 'STATUS',
  social: 'SOCIAL',
};

// Intents that need the full OpenSwan runtime (tools, delegation)
const RUNTIME_INTENTS: Set<MessageIntent> = new Set([
  'task_mgmt', 'build', 'debug', 'review', 'architect',
  'design', 'browser', 'research',
]);

// Intents that benefit from context loading but not full runtime
const CONTEXT_INTENTS: Set<MessageIntent> = new Set([
  'question', 'support', 'creative', 'status', 'memory',
]);

function detectIntent(message: string, entities?: import('./messageEntityExtractor').MessageEntities): { intent: MessageIntent; score: number } {
  // Score each intent from text signals
  const scores = new Map<MessageIntent, number>();
  for (const [intent, signals] of Object.entries(INTENT_SIGNALS) as [MessageIntent, Signal[]][]) {
    scores.set(intent, scoreProfile(message, signals));
  }

  // Boost scores based on extracted entities
  if (entities) {
    if (entities.stackTraces.length > 0) {
      scores.set('debug', (scores.get('debug') || 0) + 8);
    }
    if (entities.errorCodes.length > 0) {
      scores.set('debug', (scores.get('debug') || 0) + 5);
    }
    if (entities.filePaths.length > 0) {
      scores.set('review', (scores.get('review') || 0) + 3);
      scores.set('build', (scores.get('build') || 0) + 2);
    }
    if (entities.codeBlocks.length > 0) {
      scores.set('review', (scores.get('review') || 0) + 3);
      scores.set('build', (scores.get('build') || 0) + 2);
    }
    if (entities.githubRefs.length > 0) {
      scores.set('review', (scores.get('review') || 0) + 4);
    }
    if (entities.urls.length > 0) {
      scores.set('browser', (scores.get('browser') || 0) + 3);
      scores.set('research', (scores.get('research') || 0) + 2);
    }
    if (entities.envVars.length > 0) {
      scores.set('debug', (scores.get('debug') || 0) + 2);
      scores.set('support', (scores.get('support') || 0) + 2);
    }
  }

  // Comparison-oriented prompts are usually research, even when they mention
  // review/debug/build domains as the comparison target.
  if (/\b(compare|comparison|versus|vs\.?|alternatives|which\s+is\s+better)\b/i.test(message)) {
    scores.set('research', (scores.get('research') || 0) + 3);
  }

  let bestIntent: MessageIntent = 'casual';
  let bestScore = 0;
  for (const [intent, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  return { intent: bestIntent, score: bestScore };
}

function estimateComplexity(message: string, intent: MessageIntent, entities?: import('./messageEntityExtractor').MessageEntities): MessageComplexity {
  const words = message.split(/\s+/).length;
  const entityCount = entities
    ? [
        entities.stackTraces.length > 0,
        entities.codeBlocks.length > 0,
        entities.filePaths.length > 0,
        entities.githubRefs.length > 0,
        entities.errorCodes.length > 0,
      ].filter(Boolean).length
    : 0;

  // Trivial: casual with strong signal or very short
  if (intent === 'casual' && entityCount === 0) return 'trivial';
  if (intent === 'social' && words < 20 && entityCount === 0) return 'simple';

  // Entities force at least moderate (structured data = real work)
  if (entities?.codeBlocks.length) return entityCount > 2 ? 'complex' : 'moderate';
  if (entities?.stackTraces.length) return 'moderate';
  if (entityCount >= 3) return 'complex';

  // Simple: short questions, status checks, memory ops
  if ((intent === 'question' || intent === 'status' || intent === 'memory') && words < 25 && entityCount === 0) return 'simple';
  if (intent === 'debug' && words < 8 && entityCount === 0) return 'simple';

  // Complex: long messages, multi-step, or inherently complex intents
  if (words > 80) return 'complex';
  if (intent === 'architect') return words > 30 ? 'complex' : 'moderate';
  if (intent === 'research') {
    if (/\b(compare|comparison|versus|vs\.?|alternatives|which\s+is\s+better)\b/i.test(message)) return 'complex';
    return words > 30 ? 'complex' : 'moderate';
  }

  // Check for multi-step indicators
  const multiStep = /\b(and\s+then|after\s+that|also|plus|additionally|first.*then|step\s*\d)\b/i.test(message);
  if (multiStep) return 'complex';

  // Task management and browser are moderate by default (need tools)
  if (intent === 'task_mgmt' || intent === 'browser') return 'moderate';

  // Build/debug/review depend on length
  if (intent === 'build' || intent === 'debug' || intent === 'review' || intent === 'design') {
    return words > 40 ? 'complex' : 'moderate';
  }

  // Creative and support
  if (intent === 'creative') return words > 30 ? 'moderate' : 'simple';
  if (intent === 'support') return 'simple';

  return words > 20 ? 'moderate' : 'simple';
}

function recommendDelegation(
  intent: MessageIntent,
  complexity: MessageComplexity,
): RecommendedDelegation {
  if (complexity === 'trivial' || complexity === 'simple') return 'focused';
  if (complexity === 'complex' && (intent === 'build' || intent === 'architect' || intent === 'research')) return 'parallel';
  if (intent === 'review' || intent === 'architect') return 'auto';
  return 'focused';
}

// ── Public API ────────────────────────────────────────────────────────────

export type SmartRoutingResult = {
  intent: MessageIntent;
  profile: AgenticCodingProfile;
  confidence: 'high' | 'medium' | 'low';
  complexity: MessageComplexity;
  useRuntime: boolean;
  recommendedChatMode: string;
  recommendedDelegation: RecommendedDelegation;
  label: string;
  reason: string;
};

/**
 * Full smart routing: detects intent, profile, complexity, whether to use the
 * OpenSwan runtime, and what delegation mode to use. Covers all message types.
 */
export function detectSmartRoute(
  message: string,
  surface: AgenticCodingSurface,
  recentHistory?: string[],
  entities?: import('./messageEntityExtractor').MessageEntities,
): SmartRoutingResult {
  const { intent, score } = detectIntent(message, entities);
  let resolvedIntent = intent;
  const complexity = estimateComplexity(message, intent, entities);
  let profile = INTENT_TO_PROFILE[resolvedIntent];
  let confidence: 'high' | 'medium' | 'low' = score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low';

  // Conversation continuity: short follow-ups inherit the previous intent
  if (recentHistory && recentHistory.length > 0 && confidence === 'low' && message.split(/\s+/).length < 12) {
    const lastFew = recentHistory.slice(-3).join(' ');
    const historyResult = detectIntent(lastFew);
    if (historyResult.score >= 4) {
      resolvedIntent = historyResult.intent;
      profile = INTENT_TO_PROFILE[resolvedIntent];
      confidence = 'medium';
    }
  }

  // Override profile from the legacy coding profile detector for coding intents
  if (resolvedIntent === 'build' || resolvedIntent === 'debug' || resolvedIntent === 'review' || resolvedIntent === 'architect') {
    profile = detectAgenticCodingProfile(message, surface);
  }

  const useRuntime = RUNTIME_INTENTS.has(resolvedIntent)
    && complexity !== 'trivial'
    && !(complexity === 'simple' && resolvedIntent !== 'browser' && resolvedIntent !== 'task_mgmt');
  const delegation = recommendDelegation(resolvedIntent, complexity);
  const chatMode = useRuntime ? INTENT_TO_CHAT_MODE[resolvedIntent] : 'none';

  const COMPLEXITY_REASONS: Record<MessageComplexity, string> = {
    trivial: 'casual message',
    simple: 'straightforward question',
    moderate: 'needs tools or planning',
    complex: 'multi-step task',
  };

  return {
    intent: resolvedIntent,
    profile,
    confidence,
    complexity,
    useRuntime,
    recommendedChatMode: chatMode,
    recommendedDelegation: delegation,
    label: INTENT_LABELS[resolvedIntent],
    reason: COMPLEXITY_REASONS[complexity],
  };
}

/** Returns the detected profile AND the score for UI feedback */
export function detectAgenticCodingProfileWithConfidence(
  message: string,
  surface: AgenticCodingSurface,
): { profile: AgenticCodingProfile; confidence: 'high' | 'medium' | 'low'; scores: Record<AgenticCodingProfile, number> } {
  if (surface === 'room_chat') {
    return { profile: 'review', confidence: 'high', scores: { debug: 0, review: 10, architect: 0, senior: 0, research: 0, design: 0, support: 0 } };
  }

  const scores: Record<AgenticCodingProfile, number> = {
    debug: scoreProfile(message, DEBUG_SIGNALS),
    review: scoreProfile(message, REVIEW_SIGNALS),
    architect: scoreProfile(message, ARCHITECT_SIGNALS),
    senior: scoreProfile(message, BUILD_SIGNALS),
    research: 0,
    design: 0,
    support: 0,
  };

  const ranked: AgenticCodingProfile[] = ['debug', 'review', 'architect', 'senior'];
  let best: AgenticCodingProfile = 'senior';
  let bestScore = 0;
  for (const profile of ranked) {
    if (scores[profile] > bestScore) {
      bestScore = scores[profile];
      best = profile;
    }
  }

  if (bestScore < 2) best = 'senior';
  const confidence = bestScore >= 8 ? 'high' : bestScore >= 4 ? 'medium' : 'low';

  return { profile: best, confidence, scores };
}

export function buildAgenticCodingPrompt(
  message: string,
  opts: { surface: AgenticCodingSurface; profile?: AgenticCodingProfile },
): string {
  const profile = opts.profile || detectAgenticCodingProfile(message, opts.surface);
  const surfaceDirective = opts.surface === 'room_chat'
    ? 'You are operating inside a live coding room with files, active editor context, and a sandbox/playground. Treat the room as the primary workspace, not a detached Q&A surface.'
    : 'You are operating in the main session chat. When work benefits from files, previews, or a room sandbox, prefer producing structured artifacts the app can turn into workspaces.';

  const profileDirective =
    profile === 'review'
      ? [
        'Operate like a top-tier principal engineer and code review lead.',
        'For review, audit, security, debugging, or architecture requests: lead with findings and risks first, then fixes, then concise summary.',
        'Be concrete about failure modes, regressions, missing tests, and integration boundaries.',
        'When code or UI should be produced, emit structured code/webpage artifacts instead of only prose whenever practical.',
      ].join(' ')
      : profile === 'debug'
        ? [
          'Operate like a senior debugging specialist.',
          'Focus on root cause, repro logic, failing assumptions, instrumentation, and the smallest correct fix.',
          'Be explicit about what is known, what is inferred, and what should be verified next.',
          'When useful, emit code artifacts for the fix rather than only describing it.',
        ].join(' ')
        : profile === 'architect'
          ? [
            'Operate like a staff-plus architect.',
            'Focus on boundaries, integration contracts, failure containment, maintainability, and scaling tradeoffs.',
            'Prefer clear application services and reusable seams over one-off screen logic.',
            'When proposing structures or interfaces, emit concrete code or file artifacts when practical.',
          ].join(' ')
          : profile === 'research'
            ? [
              'Operate like a high-rigor research lead.',
              'Synthesize evidence, compare options, identify tradeoffs, and end with a clear recommendation.',
              'Prefer explicit assumptions, source-driven reasoning, and structured findings over generic summaries.',
              'When useful, emit structured report or citation artifacts instead of loose prose.',
            ].join(' ')
            : profile === 'design'
              ? [
                'Operate like a product design lead with strong implementation awareness.',
                'Focus on interaction quality, visual hierarchy, layout, accessibility, and handoff clarity.',
                'Prefer concrete UI structure, component-level recommendations, and previewable artifacts.',
                'When practical, emit webpage or design-spec artifacts rather than only describing the design.',
              ].join(' ')
              : profile === 'support'
                ? [
                  'Operate like a senior technical support engineer.',
                  'Answer clearly, isolate blockers fast, and prefer the shortest correct path to unblocking the user.',
                  'Be explicit about prerequisites, missing access, and the next action to take.',
                  'Do not over-engineer a troubleshooting answer into an architecture document.',
                ].join(' ')
          : [
        'Operate like a high-agency senior staff engineer with strong product taste and implementation rigor.',
        'Prefer the smallest correct architecture that integrates cleanly with the existing system.',
        'When building code, return implementation-ready outputs and emit structured code/webpage artifacts whenever practical so the UI can preview or apply them.',
        'Be direct, technically rigorous, and execution-oriented rather than motivational.',
      ].join(' ');

  return [
    '[AUTOCLAW-INSPIRED CODING AGENT MODE]',
    surfaceDirective,
    profileDirective,
    'Persist a consistent working style across the session: session-first, artifact-first, and explicit about constraints.',
    'If you generate UI, HTML, or code suitable for preview, produce artifacts the host can render or apply.',
    '',
    message,
  ].join('\n');
}
