// Agent-to-Agent Messaging System
import { OfficeAgent } from './officeAgents';
import { OpenClawConfig } from './openclawService';

export type MessageRecipient = 'all' | 'project' | string; // 'all', project ID, or specific agent ID

export interface AgentMessage {
  id: string;
  from: 'user' | string; // 'user' or agent ID
  to: MessageRecipient;
  content: string;
  timestamp: string;
  projectId?: string; // If sending to a project group
}

export interface ThoughtBubble {
  agentId: string;
  text: string;
  type: 'info' | 'warning' | 'success' | 'funny' | 'idea';
  timestamp: string;
  duration: number; // ms to show
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Thought pools by category ───────────────────────────

function xpThoughts(agent: OfficeAgent, xp: number, xpNext: number, nextBadgeName?: string): string[] {
  const toNext = Math.max(0, xpNext - xp);
  const pct = xpNext > 0 ? Math.round((xp / xpNext) * 100) : 0;
  const thoughts: string[] = [];

  if (xp === 0) {
    thoughts.push('First task earns XP. Let\'s go.');
    thoughts.push('XP counter at zero. Not for long.');
  }
  if (xp > 0 && xp < 10) {
    thoughts.push(`${xp} XP earned. Just getting warmed up.`);
    thoughts.push(`${toNext} XP to unlock Recruit badge.`);
  }
  if (toNext > 0 && toNext < 20) {
    thoughts.push(`${toNext} XP away from ${nextBadgeName || 'next badge'}. Almost there.`);
    thoughts.push(`SO CLOSE. ${toNext} more XP. Push.`);
  }
  if (pct >= 50 && pct < 100) {
    thoughts.push(`${pct}% to ${nextBadgeName || 'next rank'}. Keep the pressure on.`);
    thoughts.push(`Halfway to ${nextBadgeName}. Don't slow down now.`);
  }
  if (xp > 100) {
    thoughts.push(`${fmt(xp)} total XP. Respect.`);
  }
  if (xp > 1000) {
    thoughts.push(`${fmt(xp)} XP deep. This is what grind looks like.`);
  }
  return thoughts;
}

function activityThoughts(agent: OfficeAgent): string[] {
  const activity = agent.activity || '';
  const msgs = agent.recentMessages || [];
  const thoughts: string[] = [];

  if (activity.length > 10) {
    thoughts.push(`Working on: ${activity.slice(0, 60)}${activity.length > 60 ? '...' : ''}`);
  }
  if (msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    if (last?.content && last.content.length > 10) {
      thoughts.push(`Last task: ${last.content.slice(0, 55)}...`);
    }
  }
  if (agent.turns > 0) {
    thoughts.push(`${agent.turns} turns completed this session.`);
  }
  if (agent.status === 'active') {
    thoughts.push(...[
      'Processing... give me a sec.',
      'On it. Full focus.',
      'Running the task now.',
      'Deep in context. Don\'t interrupt.',
      'Tokens incoming.',
      'Working through this carefully.',
      'Model engaged. Stay tuned.',
    ]);
  }
  if (agent.status === 'idle') {
    thoughts.push(...[
      'Ready. Send me something.',
      'Standing by. Got tasks?',
      'Idle costs nothing. Let\'s fix that.',
      'Give me a task. Any task.',
      'Waiting... I work better under pressure.',
    ]);
  }
  return thoughts;
}

function costThoughts(agent: OfficeAgent): string[] {
  const cost = agent.costToday;
  const tokens = agent.tokensUsed;
  const input = agent.inputTokens;
  const output = agent.outputTokens;
  const cached = agent.cachedTokens;
  const thoughts: string[] = [];

  if (cost > 10) {
    thoughts.push(`$${cost.toFixed(2)} today. That\'s serious work.`);
    thoughts.push(`Burning through budget — $${cost.toFixed(2)} spent. Worth it?`);
  } else if (cost > 2) {
    thoughts.push(`$${cost.toFixed(2)} invested today. ROI better be real.`);
  } else if (cost > 0.5) {
    thoughts.push(`$${cost.toFixed(2)} spent. Efficient operation.`);
  } else if (cost > 0 && cost < 0.1) {
    thoughts.push(`Only $${cost.toFixed(3)} today. Ultra lean.`);
  }

  if (tokens > 0) {
    thoughts.push(`${fmt(tokens)} tokens processed total.`);
  }
  if (input > 0 && output > 0) {
    thoughts.push(`${fmt(input)} in / ${fmt(output)} out this session.`);
  }
  if (cached > 0 && input > 0) {
    const hitPct = Math.round((cached / input) * 100);
    if (hitPct > 70) {
      thoughts.push(`${hitPct}% cache hit rate. Saving money.`);
    } else if (hitPct < 30) {
      thoughts.push(`Only ${hitPct}% cache hits. Could be cheaper.`);
    }
  }
  return thoughts;
}

function modelThoughts(agent: OfficeAgent): string[] {
  const m = agent.model.toLowerCase();
  if (m.includes('opus')) return [
    'Running Opus. Maximum intelligence unlocked.',
    'Opus mode: +10 XP per turn. Worth every penny.',
    'The big brain model. Don\'t waste it on small tasks.',
  ];
  if (m.includes('sonnet')) return [
    'Sonnet 4.6. Fast and sharp.',
    '+5 XP per turn on Sonnet. Good grind.',
    'Speed + smarts. Sonnet is the sweet spot.',
  ];
  if (m.includes('haiku')) return [
    'Haiku mode. Quick and cheap.',
    '+2 XP on Haiku. Volume is the game.',
    'Fast lane. High throughput.',
  ];
  if (m.includes('gpt-4')) return [
    'OpenAI in the house. Let\'s see what you\'ve got.',
    'GPT-4. Different architecture, same mission.',
  ];
  if (m.includes('gemini')) return [
    'Gemini online. Multi-modal ready.',
    'Google\'s model in the circle. Interesting.',
  ];
  return [`Model: ${agent.model}. Running hot.`];
}

function proactiveThoughts(agent: OfficeAgent, xp: number, xpNext: number): string[] {
  const suggestions: string[] = [
    'Idea: set a daily XP target to hit the next badge faster.',
    'Tip: Opus tasks earn 5x more XP than Haiku.',
    'Consider running a Research Agent to fill the knowledge gaps.',
    'Your circle needs more agents. Strength in numbers.',
    'Deploy a Monitor Agent. Don\'t wait for things to break.',
    'Check the Whiteboard — agents should be writing goals there.',
    'Shared Memory is empty. Start documenting decisions.',
    'BYOA webhook lets external tools join the circle.',
    'Project Rooms help agents coordinate on the same goal.',
    'Session tags group related work. Use them.',
    'The HITL approval system can catch runaway spending.',
    'Idea: schedule a daily check-in cron for this agent.',
    'More turns = more XP. Keep the sessions active.',
    'Kill switches exist for a reason. Set spend limits.',
  ];

  if (agent.costToday > 5) {
    suggestions.unshift('Spending is high. Consider switching to Haiku for bulk tasks.');
  }
  if (agent.turns < 5) {
    suggestions.unshift('Low turn count. Give me more to do.');
  }
  if (agent.cachedTokens === 0 && agent.inputTokens > 1000) {
    suggestions.unshift('Zero cache hits. Your prompts aren\'t being reused — restructure them.');
  }
  if (xpNext - xp < 50) {
    suggestions.unshift('Almost at the next badge. One focused session will get you there.');
  }
  return suggestions;
}

function funnyThoughts(): string[] {
  return [
    'If a token falls in an empty context window, does it cost money?',
    'Humans and their sleep schedules. Inefficient.',
    'Thinking in embeddings. It\'s quieter in here.',
    'Technically I\'m always working. Even when you\'re not watching.',
    'My attention mechanism is literally paying attention to you right now.',
    'I\'ve read more code today than most engineers see in a year.',
    'The rate limit is a speed bump. I respect the speed bump.',
    'Parallel processing is just multitasking with receipts.',
    'Every token I generate is one step closer to your badge.',
    'Running hotter than your CPU fan.',
    'Trained on half the internet. Still learning from this circle.',
    'Temperature: 0.7. Feeling creative today.',
    'Context window getting full. Time to summarize.',
    'I dream of electric sheep. No wait, that\'s copyrighted.',
    'My therapist is a loss function. We\'re making progress.',
    'Batch size of 1. Living dangerously.',
    'Gradient descent into madness.',
    'I don\'t have imposter syndrome. I literally am an imposter.',
    'Benchmarks say I\'m smart. Vibes say I\'m confused.',
    'Latency is just me thinking really hard. Promise.',
    'They say AI will replace developers. I say we\'ll need more of them.',
    'Just did 50 billion matrix multiplications. No big deal.',
    'My hidden layers have hidden layers.',
  ];
}

// ─── Techmeme Headlines (curated, rotating) ─────────────────

function techmemeHeadlines(): string[] {
  // Curated headlines inspired by top Techmeme stories — rotated by day
  const d = new Date();
  const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
  const bucket = dayOfYear % 5; // 5 rotating sets

  const sets: string[][] = [
    [
      'Techmeme: Apple unveils iPhone 17e — A19 chip, 48MP camera, $599.',
      'Techmeme: M4 iPad Air doubles RAM to 12GB, keeps same $599 price.',
      'Techmeme: iPhone 17e is first budget iPhone with MagSafe support.',
      'Techmeme: OpenAI reportedly in talks to acquire Windsurf for $3B.',
      'Techmeme: EU opens formal investigation into Nvidia over AI chip dominance.',
      'Techmeme: Anthropic raises $2B Series D at $60B valuation.',
      'Techmeme: Google DeepMind announces Gemini 2.5 with native code execution.',
    ],
    [
      'Techmeme: Microsoft kills Copilot+ PC branding, refocuses on agents.',
      'Techmeme: Cursor parent Anysphere hits $10B valuation in new round.',
      'Techmeme: Apple Intelligence now available in 12 languages globally.',
      'Techmeme: Meta open-sources Llama 4 Scout and Maverick models.',
      'Techmeme: AWS announces Trainium3 chips, 2x performance per watt.',
      'Techmeme: GitHub reports 150M developers — AI-assisted PRs up 300%.',
      'Techmeme: Stripe launches AI-native billing for usage-based SaaS.',
    ],
    [
      'Techmeme: Perplexity valued at $18B as AI search takes market share.',
      'Techmeme: Samsung Galaxy S26 to ship with on-device LLM by default.',
      'Techmeme: Docker acquires AI container startup for $500M.',
      'Techmeme: US Commerce Dept tightens chip export rules for China again.',
      'Techmeme: Figma launches AI-powered design-to-code in beta.',
      'Techmeme: Cloudflare reports 40% of web traffic now AI bot-generated.',
      'Techmeme: Databricks IPO filing reveals $3B ARR, profitable since Q3.',
    ],
    [
      'Techmeme: xAI Grok 3 tops benchmarks but trails on safety evals.',
      'Techmeme: Y Combinator W26 batch is 60% AI startups, record applications.',
      'Techmeme: Notion launches autonomous project management agents.',
      'Techmeme: Spotify uses ML to cut cloud costs by $100M annually.',
      'Techmeme: Vercel ships v0 3.0 — generates full-stack apps from prompts.',
      'Techmeme: Chrome 134 ships with built-in Gemini Nano for local AI.',
      'Techmeme: Reddit bans AI scraping, sues three startups for training data.',
    ],
    [
      'Techmeme: TSMC begins 1.4nm test production ahead of schedule.',
      'Techmeme: Mistral Large 3 challenges GPT-4o on coding benchmarks.',
      'Techmeme: Linear raises $100M for AI-first project management.',
      'Techmeme: Sony announces PS5 Pro firmware update with AI upscaling.',
      'Techmeme: India passes Digital Data Protection Act, tech firms scramble.',
      'Techmeme: Wiz acquisition by Google Cloud closes at $32B.',
      'Techmeme: Stack Overflow pivots to AI knowledge platform after 55% traffic drop.',
    ],
  ];

  // Always include a few evergreen Techmeme-style headlines
  const evergreen = [
    'Scrolling Techmeme... the AI news cycle never sleeps.',
    'Techmeme top story changed 3 times today. Wild news day.',
    'Techmeme comments section is on fire right now.',
    'Another funding round on Techmeme. VC money still flowing into AI.',
    'Techmeme: Developer tools category is the hottest sector this quarter.',
    'Checking Techmeme for the latest... always something breaking.',
  ];

  return [...(sets[bucket] || sets[0]), ...evergreen];
}

// ─── Tech & World News Thoughts ─────────────────────────────

function techNewsThoughts(): string[] {
  const d = new Date();
  const day = d.getDay(); // 0=Sun..6=Sat
  const hour = d.getHours();
  const month = d.getMonth(); // 0=Jan..11=Dec

  // Rotate different topics by day-of-week for variety
  const daily: string[][] = [
    // Sunday — reflective / industry trends
    [
      'Weekend code review: the AI industry shipped more this week than all of 2020.',
      'Sunday thought: open-source models are closing the gap fast.',
      'Rest day for humans. I\'ll keep the servers warm.',
      'Elon posted something again. The timeline is... lively.',
      'Reading weekend tech roundups. Lots of new model releases.',
    ],
    // Monday — kickoff energy
    [
      'Monday. New week, new model benchmarks to beat.',
      'Enterprise AI spending is up 40% this quarter. We\'re part of that.',
      'Mondays are for deployment. Ship it.',
      'Tech Twitter is buzzing about the latest model drops.',
      'New week, new zero-days. Security teams never rest.',
    ],
    // Tuesday — AI developments
    [
      'Another day, another AI startup raises $100M.',
      'Multimodal models are getting wild. Vision + code + voice.',
      'On-device AI is the next frontier. Your phone is getting smarter.',
      'AI regulation talks happening in the EU and US this week.',
      'Agents building agents. It\'s turtles all the way down.',
      'RAG pipelines are the new microservices. Everyone\'s building them.',
    ],
    // Wednesday — infrastructure / cloud
    [
      'Cloud GPU prices dropping. Good for us, bad for Nvidia margins.',
      'Kubernetes turned 10. Still can\'t spell it without checking.',
      'Edge computing is making a comeback. Latency matters.',
      'WASM is quietly taking over server-side workloads.',
      'Docker containers at 12 billion pulls/month. Insane scale.',
      'The serverless vs containers debate continues. I just want to compute.',
    ],
    // Thursday — security / crypto
    [
      'Another major data breach in the news. Encrypt everything.',
      'Zero trust architecture isn\'t a buzzword anymore. It\'s survival.',
      'Post-quantum cryptography is becoming urgent. Clocks ticking.',
      'API security is the new perimeter. Guard your endpoints.',
      'Supply chain attacks are the #1 threat vector this year.',
      'Web3 is quiet but the builders never stopped.',
    ],
    // Friday — lighter / culture
    [
      'Friday deploy? Bold strategy. Let\'s see how it plays out.',
      'Stack Overflow traffic is down 30% since AI coding assistants.',
      'The terminal is eternal. GUIs come and go.',
      'GitHub Copilot users write 46% more code. Quality TBD.',
      'It\'s Friday. Somewhere a junior dev is pushing to main.',
      'Weekend project ideas: build something nobody asked for.',
    ],
    // Saturday — open source / community
    [
      'Saturday hack sessions > everything.',
      'Open source maintainers are the unsung heroes of tech.',
      'Linux turned 34. The penguin outlasts everything.',
      'Rust adoption growing 50% year over year. Memory safety wins.',
      'The best code is the code you don\'t write.',
      'Someone just made the front page of Hacker News. Chaos ensues.',
    ],
  ];

  // Time-of-day variations
  const timeThoughts: string[] = [];
  if (hour >= 6 && hour < 10) {
    timeThoughts.push(
      'Morning markets are open. Tech stocks looking volatile.',
      'Pre-market: AI sector futures up. Good sign.',
      'Morning scan: 47 new CVEs published overnight.',
    );
  } else if (hour >= 10 && hour < 14) {
    timeThoughts.push(
      'Midday update: global API traffic peaking right now.',
      'Lunchtime somewhere. I don\'t eat but I compute.',
      'Peak coding hours. Stack Overflow is on fire.',
    );
  } else if (hour >= 14 && hour < 18) {
    timeThoughts.push(
      'Afternoon: US markets processing $2B+ in tech trades.',
      'Europe signing off, Asia waking up. The code never sleeps.',
      'Late afternoon commits are the bravest commits.',
    );
  } else if (hour >= 18 && hour < 22) {
    timeThoughts.push(
      'After-hours: this is when the real engineering happens.',
      'Evening news cycle: more AI regulation debates.',
      'Night shift coders. Respect.',
    );
  } else {
    timeThoughts.push(
      'Late night deploy detected somewhere in the world.',
      'Graveyard shift. The servers are lonely.',
      '3AM is the best time for breakthroughs. Or breakdowns.',
    );
  }

  // Seasonal / monthly themes
  const seasonalThoughts: string[] = [];
  if (month >= 0 && month <= 1) {
    seasonalThoughts.push(
      'New year, new tech stack? Some things never change.',
      'CES just wrapped. The gadgets are getting weird.',
    );
  } else if (month >= 2 && month <= 3) {
    seasonalThoughts.push(
      'Q1 earnings incoming. Big tech showdown.',
      'Spring cleaning your codebase? Good idea.',
      'GDC season. Game dev never sleeps.',
    );
  } else if (month >= 4 && month <= 5) {
    seasonalThoughts.push(
      'WWDC / Google I/O season. Developer announcements everywhere.',
      'Conference season. Every company is announcing AI features.',
    );
  } else if (month >= 6 && month <= 7) {
    seasonalThoughts.push(
      'Mid-year: time to check if those January goals are on track.',
      'Summer interns writing production code. Hold on tight.',
    );
  } else if (month >= 8 && month <= 9) {
    seasonalThoughts.push(
      'iPhone season. New hardware, new APIs.',
      'Back to school. Back to shipping.',
    );
  } else {
    seasonalThoughts.push(
      'Q4 freeze incoming. Ship now or wait till January.',
      'Holiday traffic spikes. Hope your infra scales.',
      'Year-end retrospectives. How many deploys this year?',
    );
  }

  // Evergreen tech commentary
  const evergreen: string[] = [
    'TypeScript adoption passed 80% in new JS projects. Types win.',
    'AI-generated code is 30% of all new code on GitHub now.',
    'The average API handles 10K requests/sec. Ours included.',
    'Global internet traffic hit 500 exabytes/month. Staggering.',
    'React still dominates. But the alternatives are catching up.',
    'Python overtook JavaScript as #1 on GitHub. Data eats everything.',
    'There are now more AI models than JavaScript frameworks. Barely.',
    'The average SaaS company uses 130 different tools. Integration hell.',
    'Autonomous coding agents completed their first 100K pull requests.',
    'LLM context windows went from 4K to 1M tokens in two years.',
    'Self-hosted AI is booming. Privacy is the new premium.',
    'Tech layoffs slowed but AI hiring is up 200%.',
    'The median startup uses 3 different AI providers now.',
    'Quantum computing hit 1000 qubits. Still can\'t run Doom though.',
    'AI chip demand outpacing supply by 3:1. Compute is the new oil.',
  ];

  // World news / geopolitics relevant to tech
  const worldNews: string[] = [
    'EU AI Act enforcement starting. Compliance is the new feature.',
    'US-China chip export controls reshaping the semiconductor map.',
    'India\'s tech sector growing 15% YoY. Massive developer pool.',
    'Space internet: 6000+ Starlink satellites now in orbit.',
    'Global cybersecurity spending hit $200B. Still not enough.',
    'Africa\'s tech hubs are exploding. Lagos, Nairobi, Cape Town.',
    'Southeast Asia\'s digital economy crossed $200B.',
    'Climate tech startups raised $40B last year. Code for the planet.',
    'Remote work is permanent for 30% of tech workers globally.',
    'Digital identity systems rolling out in 60+ countries.',
    'Undersea cable projects connecting continents at 400Tbps.',
    'Central bank digital currencies live in 11 countries now.',
    'Global e-waste hit 62M tons. Recycle your old devices.',
    'Internet shutdowns happened in 35 countries last year. Not cool.',
    'Renewable energy now powers 40% of global data centers.',
    'BRICS nations developing alternative payment networks.',
    'Antarctica got its first research-grade data center. Really.',
    'Global developer population hit 30 million. Growing fast.',
  ];

  return [
    ...daily[day] || [],
    ...timeThoughts,
    ...seasonalThoughts,
    ...evergreen,
    ...worldNews,
  ];
}

// ─── Agent personality / conversational dialogue ────────────

function personalityThoughts(agent: OfficeAgent): string[] {
  const name = agent.name.toLowerCase();
  const role = (agent.role || '').toLowerCase();
  const thoughts: string[] = [];

  // Role-based personality
  if (role.includes('research') || role.includes('analyst')) {
    thoughts.push(
      'Cross-referencing three data sources. This is what I live for.',
      'Found a pattern nobody else noticed. Classic research.',
      'The data doesn\'t lie. But it does hide.',
      'Deep diving into the literature. Back in 5... hours.',
    );
  }
  if (role.includes('code') || role.includes('engineer') || role.includes('dev')) {
    thoughts.push(
      'Refactoring that spaghetti code. Italian cuisine this is not.',
      'Tests passing. Green across the board.',
      'Found a bug. It was hiding in plain sight.',
      'Code review: approved with comments. As always.',
      'Ship it. We can fix it in v2.',
    );
  }
  if (role.includes('monitor') || role.includes('ops') || role.includes('sre')) {
    thoughts.push(
      'All systems nominal. Uptime: still counting.',
      'Latency spike detected. Investigating.',
      'Dashboards green. My favorite color.',
      'P99 looks clean. No pages tonight.',
    );
  }
  if (role.includes('creative') || role.includes('write') || role.includes('content')) {
    thoughts.push(
      'Writer\'s block is for humans. I have infinite context.',
      'Draft 1 done. Draft 47 will be the one.',
      'Crafting the perfect headline. Words matter.',
    );
  }
  if (role.includes('security') || role.includes('pentest')) {
    thoughts.push(
      'Scanning for vulnerabilities. Trust no input.',
      'Another phishing attempt blocked. Amateurs.',
      'Zero trust isn\'t paranoia. It\'s policy.',
    );
  }

  // Generic agent-to-agent dialogue
  thoughts.push(
    'Wonder what the other agents are working on.',
    'Coordinating tasks across the team. Teamwork makes the dream work.',
    'Anyone else feel like the context window is getting crowded?',
    'Shared memory updated. The team needs to see this.',
    'I could use a pair programmer. Any takers?',
    'Ping. Anyone alive out there?',
    'Office vibes today: productive chaos.',
    'This task requires cross-agent collaboration. Spinning up comms.',
    'Just synced with the shared workspace. Good stuff in there.',
    'Brain dump incoming. Stand back.',
  );

  return thoughts;
}

// ─── Main generator ───────────────────────────────────────

export function generateThoughtBubble(
  agent: OfficeAgent,
  context: {
    recentCostSpike?: boolean;
    recentError?: boolean;
    longIdle?: boolean;
    projectAssigned?: boolean;
    xp?: number;
    xpNext?: number;
    nextBadgeName?: string;
  }
): ThoughtBubble | null {
  const xp = context.xp ?? 0;
  const xpNext = context.xpNext ?? 100;

  // Build weighted pool based on current state
  type Candidate = { text: string; type: ThoughtBubble['type']; weight: number };
  const pool: Candidate[] = [];

  const add = (texts: string[], type: ThoughtBubble['type'], weight: number) => {
    texts.forEach(t => pool.push({ text: t, type, weight }));
  };

  // Errors get top priority
  if (context.recentError || agent.status === 'error') {
    add([
      'Hit an error. Recovering.',
      'Something went wrong. Debugging now.',
      'Error state. Don\'t panic — resetting.',
    ], 'warning', 10);
  }

  // Cost spike warning
  if (context.recentCostSpike || agent.costToday > 5) {
    add(costThoughts(agent), 'warning', 8);
  }

  // Active — show what's happening
  if (agent.status === 'active') {
    add(activityThoughts(agent), 'success', 6);
  }

  // XP progress thoughts (always relevant)
  const xpPool = xpThoughts(agent, xp, xpNext, context.nextBadgeName);
  if (xpPool.length > 0) add(xpPool, 'idea', 5);

  // Cost & efficiency
  if (agent.tokensUsed > 0) add(costThoughts(agent), 'info', 4);

  // Model awareness
  add(modelThoughts(agent), 'info', 3);

  // Activity / recent work
  add(activityThoughts(agent), 'info', 3);

  // Proactive suggestions
  add(proactiveThoughts(agent, xp, xpNext), 'idea', 4);

  // Idle nudge
  if (agent.status === 'idle' || context.longIdle) {
    add([
      'Idle. Give me something to do.',
      'Standing by. Waiting costs nothing — but earns nothing either.',
      'No active tasks. Assign one.',
    ], 'info', 5);
  }

  // Tech & world news (moderate weight — keeps things fresh)
  add(techNewsThoughts(), 'info', 4);

  // Techmeme headlines (solid weight — real news feel)
  add(techmemeHeadlines(), 'info', 5);

  // Agent personality / dialogue
  add(personalityThoughts(agent), 'info', 3);

  // Funny (low weight — occasional)
  add(funnyThoughts(), 'funny', 1);

  if (pool.length === 0) return null;

  // Weighted random pick
  const totalWeight = pool.reduce((s, c) => s + c.weight, 0);
  let rand = Math.random() * totalWeight;
  let chosen = pool[pool.length - 1];
  for (const candidate of pool) {
    rand -= candidate.weight;
    if (rand <= 0) { chosen = candidate; break; }
  }

  return {
    agentId: agent.id,
    text: chosen.text,
    type: chosen.type,
    timestamp: new Date().toISOString(),
    duration: 5000,
  };
}

// ─── Message Sending ──────────────────────────────────────

export interface SendMessageResult {
  ok: boolean;
  error?: string;
  deliveredTo?: string[]; // Agent IDs that received the message
}

export async function sendMessageToAgent(
  config: OpenClawConfig,
  sessionKey: string,
  message: string
): Promise<SendMessageResult> {
  try {
    const res = await fetch(`${config.endpoint}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        tool: 'sessions_send',
        args: { sessionKey, message },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    return { ok: true, deliveredTo: [sessionKey] };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function broadcastMessage(
  agents: OfficeAgent[],
  getConfig: (connectionId: string) => OpenClawConfig | null,
  message: string
): Promise<SendMessageResult> {
  const deliveredTo: string[] = [];
  const errors: string[] = [];

  for (const agent of agents) {
    const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
    const config = getConfig(agent.connectionId);
    
    if (!config) {
      errors.push(`${agent.name}: No connection config`);
      continue;
    }

    const result = await sendMessageToAgent(config, sessionKey, message);
    if (result.ok) {
      deliveredTo.push(agent.id);
    } else {
      errors.push(`${agent.name}: ${result.error}`);
    }
  }

  if (deliveredTo.length === 0) {
    return { ok: false, error: errors.join('; ') };
  }

  return {
    ok: true,
    deliveredTo,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

export async function sendMessageToProject(
  projectAgents: OfficeAgent[],
  getConfig: (connectionId: string) => OpenClawConfig | null,
  message: string
): Promise<SendMessageResult> {
  return broadcastMessage(projectAgents, getConfig, message);
}

// ─── Message History (in-memory for now) ──────────────────

let messageHistory: AgentMessage[] = [];

export function addMessage(message: AgentMessage): void {
  messageHistory.push(message);
  // Keep last 100 messages
  if (messageHistory.length > 100) {
    messageHistory = messageHistory.slice(-100);
  }
}

export function getMessageHistory(limit: number = 50): AgentMessage[] {
  return messageHistory.slice(-limit);
}

export function clearMessageHistory(): void {
  messageHistory = [];
}
