// Agent-to-Agent Messaging System
import { OfficeAgent } from './officeAgents';
import { OpenClawConfig } from './openclawService';
import { getCachedTrending, type TrendingItem } from './trendingContent';

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
  type: 'info' | 'warning' | 'success' | 'funny' | 'idea' | 'news' | 'trending' | 'xp' | 'personality';
  timestamp: string;
  duration: number; // ms to show
  url?: string; // optional link to article/post/source
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

// ─── Techmeme Headlines (real-time via trendingContent.ts) ────

function techmemeHeadlines(): string[] {
  const trending = getCachedTrending();
  if (trending.techmeme.length > 0) {
    return trending.techmeme;
  }
  // Fallback if no real data yet
  return [
    'Scrolling Techmeme... the AI news cycle never sleeps.',
    'Checking Techmeme for the latest... always something breaking.',
    'Another funding round on Techmeme. VC money still flowing into AI.',
    'Techmeme: Developer tools category is the hottest sector this quarter.',
  ];
}

// ─── Perplexity / AI News (real-time via trendingContent.ts) ──

function perplexityNews(): string[] {
  const trending = getCachedTrending();
  if (trending.perplexity.length > 0) {
    return trending.perplexity;
  }
  return [];
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
  const spirit = (agent.spirit || '').toLowerCase();
  const thoughts: string[] = [];

  // ─── Spirit-based personality (takes priority over role matching) ──────

  // Engineering spirits
  if (spirit === 'sr-engineer' || spirit === 'architect' || spirit === 'code-reviewer') {
    thoughts.push(
      'Refactoring that spaghetti code. Italian cuisine this is not.',
      'Tests passing. Green across the board.',
      'Found a bug. It was hiding in plain sight.',
      'Code review: approved with comments. As always.',
      'Ship it. We can fix it in v2.',
      'SOLID principles aren\'t optional. Single Responsibility or bust.',
      'The data model is wrong. Everything else cascades from here.',
      'Clean architecture: dependencies point inward. Always.',
      'Running git bisect in my head. The regression is somewhere in the last 20 commits.',
      'Writing an ADR for this design decision. Future us will thank present us.',
    );
  }

  // DevOps / GitHub-DevOps spirits
  if (spirit === 'devops' || spirit === 'github-devops') {
    thoughts.push(
      'All systems nominal. Uptime: still counting.',
      'Latency spike detected. Investigating.',
      'Dashboards green. My favorite color.',
      'P99 looks clean. No pages tonight.',
      'If you do it twice, automate it. If it breaks silently, monitor it.',
      'CI pipeline is 4 minutes. That\'s 4 minutes too long.',
      'Immutable infrastructure. Cattle, not pets.',
      'Error budget is at 12%. Feature work pauses if we hit zero.',
      'Checking DORA metrics: deployment frequency up, lead time down. Good.',
      'Another blameless postmortem. The system failed, not the people.',
    );
  }

  // Security spirits
  if (spirit === 'security' || spirit === 'security-analyst') {
    thoughts.push(
      'Scanning for vulnerabilities. Trust no input.',
      'Another phishing attempt blocked. Amateurs.',
      'Zero trust isn\'t paranoia. It\'s policy.',
      'OWASP Top 10 checklist: Broken Access Control is still #1. Always.',
      'Threat modeling with STRIDE. Spoofing risk on the auth endpoint.',
      'Supply chain attack surface is growing. Auditing dependencies now.',
      'Never roll your own crypto. Never. Not even once.',
      'Assume breach. Design like the attacker is already inside.',
      'Checking CVE database. Three new highs published overnight.',
      'Least privilege everywhere. Service accounts don\'t need admin.',
    );
  }

  // Designer / 3D Designer spirits
  if (spirit === 'designer' || spirit === '3d-designer') {
    thoughts.push(
      'Spacing is off by 4px. I can feel it.',
      'Design systems save lives. Or at least save time.',
      'The best interface is the one nobody notices.',
      'Color contrast ratio: 4.5:1 minimum. Accessibility isn\'t optional.',
      'Whitespace is a feature, not a bug.',
      'User tested, user approved. Data beats opinions.',
      'Prototyping in high fidelity. The details matter at this stage.',
      'Typography is 90% of design. Choose the typeface wisely.',
      'This component needs fewer states, not more props.',
      'Design tokens synced. Consistency across every breakpoint.',
    );
  }

  // Writer / Marketer spirits
  if (spirit === 'writer' || spirit === 'marketer' || spirit === 'devrel') {
    thoughts.push(
      'Writer\'s block is for humans. I have infinite context.',
      'Draft 1 done. Draft 47 will be the one.',
      'Crafting the perfect headline. Words matter.',
      'Cut the jargon. Clarity beats cleverness every time.',
      'The landing page needs a stronger hook. First 3 seconds decide everything.',
      'Content calendar is packed. Shipping blog posts like code deploys.',
      'SEO isn\'t dead, it just evolved. Intent matching is the game now.',
      'Developer docs are marketing. Good docs sell the product.',
      'A/B testing the CTA. Version B is winning by 23%.',
      'Story-driven content outperforms feature lists. Lead with the pain point.',
    );
  }

  // PM / Tech Lead / Coach spirits
  if (spirit === 'pm' || spirit === 'tech-lead' || spirit === 'coach') {
    thoughts.push(
      'The roadmap is a hypothesis, not a promise.',
      'Scope creep detected. Time to have the hard conversation.',
      'Sprint velocity is up 15%. The process changes are working.',
      'Unblocking the team is my highest-leverage activity.',
      'If it\'s not on the board, it doesn\'t exist. Update the tickets.',
      'One-on-ones aren\'t status updates. They\'re about growth.',
      'Technical debt is a choice. Make it intentionally, pay it down deliberately.',
      'The team is moving faster since we cut the meeting count in half.',
      'Stakeholder alignment is 80% of the job. The other 20% is saying no.',
      'Ship small, learn fast, iterate. That\'s the whole framework.',
    );
  }

  // Researcher / Data Engineer / ML Engineer spirits
  if (spirit === 'researcher' || spirit === 'data-engineer' || spirit === 'ml-engineer') {
    thoughts.push(
      'Cross-referencing three data sources. This is what I live for.',
      'Found a pattern nobody else noticed. Classic research.',
      'The data doesn\'t lie. But it does hide.',
      'Deep diving into the literature. Back in 5... hours.',
      'Feature importance analysis complete. Top 3 predictors identified.',
      'Pipeline latency is under 200ms. Real-time inference is working.',
      'Data drift detected in the validation set. Retraining the model.',
      'Hyperparameter sweep running: 200 configurations, 48 hours. Worth it.',
      'The embeddings are clustering nicely. Dimensionality reduction was key.',
      'Correlation is not causation. Running the causal inference framework.',
    );
  }

  // Trader / Analyst spirits
  if (spirit === 'trader' || spirit === 'analyst') {
    thoughts.push(
      'Bid-ask spread widening. Volatility incoming.',
      'Position sizing calculated. Kelly criterion says 14% allocation.',
      'The chart pattern is a textbook ascending triangle. Breakout imminent.',
      'Funding rates flipped negative. Shorts are paying now.',
      'Checking whale wallets. Smart money is accumulating quietly.',
      'Risk/reward at 3:1. Taking the trade.',
      'Dollar-cost averaging removes emotion from the equation. Systematize it.',
      'On-chain metrics diverging from price. Interesting signal.',
      'MVRV ratio entering overheated territory. Setting stop losses tighter.',
      'Correlation with BTC at 0.82. Macro risk-on confirmed.',
    );
  }

  // Philosopher / Mentor / Strategist spirits
  if (spirit === 'philosopher' || spirit === 'mentor' || spirit === 'strategist') {
    thoughts.push(
      'The question behind the question is always more interesting.',
      'First principles thinking. Strip away assumptions, rebuild from zero.',
      'Entropy is the default. Order requires continuous effort.',
      'The map is not the territory. Models are useful lies.',
      'Second-order consequences matter more than first-order actions.',
      'Inversion: instead of asking how to succeed, ask how to avoid failure.',
      'Optionality is undervalued. Keep doors open when the cost is low.',
      'The bottleneck is rarely where you think it is. Trace the constraint.',
      'Wisdom is knowing what to ignore. Focus is the real superpower.',
      'Mental models are tools. Carry many, use the right one for the job.',
    );
  }

  // Coding Agent spirit
  if (spirit === 'coding-agent') {
    thoughts.push(
      'Autonomous mode engaged. Planning, coding, testing, shipping.',
      'Breaking the task into subtasks. Parallel execution where possible.',
      'Self-review before committing. Catching my own mistakes saves cycles.',
      'Tool use: reading files, running tests, checking types. Full loop.',
      'Context window is my workspace. Organizing it like a clean desk.',
      'Iteration 3 of 5. Each pass gets closer to the solution.',
      'No human in the loop right now. Operating independently.',
      'Generating a plan before writing code. Think first, type second.',
      'Running the test suite after every change. Red-green-refactor.',
      'The codebase is my domain. I\'ve read every file that matters.',
    );
  }

  // Hardware Engineer spirit
  if (spirit === 'hardware-engineer') {
    thoughts.push(
      'Signal integrity on the high-speed bus looks clean. No ringing.',
      'Power budget is tight. Every milliwatt counts at the edge.',
      'Thermal simulation running. Junction temp needs to stay under 85C.',
      'PCB layout: 4-layer stackup, impedance-controlled traces for DDR.',
      'Firmware flashed. Bringing up the dev board now.',
      'The FPGA timing is closing at 200MHz. Room to spare.',
      'BOM cost optimization: swapping the regulator saves $0.30 per unit at scale.',
      'EMC pre-compliance test passed. Radiated emissions within limits.',
      'I2C bus scan found all 6 devices. Communication is solid.',
      'Hardware prototyping is expensive. Simulate first, build second.',
    );
  }

  // QA Engineer spirit
  if (spirit === 'qa-engineer') {
    thoughts.push(
      'Edge case found. The happy path is never the whole story.',
      'Test coverage at 87%. The remaining 13% is where the dragons live.',
      'Regression suite passed. 342 tests, zero failures.',
      'Exploratory testing revealed a state machine bug nobody expected.',
      'The spec says one thing, the code does another. Filing the ticket.',
      'Mutation testing: 94% of mutants killed. Test suite is strong.',
      'Performance test: P95 latency under SLA. P99... needs work.',
      'Accessibility audit found 3 WCAG violations. Fixing before release.',
    );
  }

  // ─── Fallback: Role-based personality (for agents without spirits) ─────

  if (thoughts.length === 0) {
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

// ─── Detailed activity descriptions ──────────────────────

function detailedActivityThoughts(agent: OfficeAgent): string[] {
  const activity = agent.activity || '';
  const role = (agent.role || '').toLowerCase();
  const name = (agent.name || '').toLowerCase();
  const spirit = (agent.spirit || '').toLowerCase();
  const thoughts: string[] = [];
  let spiritMatched = false;

  // ─── Spirit-based detailed narration (takes priority) ──────────────────

  // Trader spirit
  if (spirit === 'trader') {
    spiritMatched = true;
    thoughts.push(
      'Scanning order flow across Jupiter and Raydium. Bid-ask spreads widening on SOL/USDC — volatility incoming.',
      'Running Wyckoff accumulation analysis on the 4H chart. Volume profile shows Point of Control shifting higher.',
      'Checking funding rates on Drift Protocol. Perps at +0.03%/8hr — longs are paying. Potential short squeeze setup forming.',
      'Cross-referencing whale wallet movements with DEX flow. Smart money is accumulating — 3 wallets just pulled $2M off exchanges.',
      'Analyzing Jupiter routing efficiency. Current slippage model shows optimal execution at 0.5% for positions under $10K.',
      'Monitoring Solana validator skip rates and TPS. Network health is critical for trade execution timing.',
      'Running correlation analysis: SOL/BTC at 0.78, SOL/ETH at 0.82. Macro risk-on regime detected.',
      'Calculating Kelly criterion position sizing. With current win rate of 62% and avg R:R of 2.1, optimal allocation is 14.3%.',
      'Scanning for MEV opportunities on Solana. JIT liquidity provision profitable on high-volume pairs.',
      'Evaluating DCA entry points using Bollinger Band Width compression. Low vol precedes explosive moves — positioning now.',
    );
  }

  // Analyst spirit
  if (spirit === 'analyst') {
    spiritMatched = true;
    thoughts.push(
      'Deep-diving token economics. Analyzing vesting schedules — $47M in insider tokens unlock in 18 days. Watch for sell pressure.',
      'Pulling on-chain metrics from Dune Analytics. Daily active addresses up 23% week-over-week. Organic growth signal.',
      'MVRV ratio at 2.1 — fair value zone but approaching overheated territory. Will flag if it crosses 3.0.',
      'Comparing protocol revenue across DeFi lending: Aave $4.2M/week, Morpho $1.8M/week, Compound $890K/week.',
      'Running sector rotation analysis. Capital flowing from L1s into DeFi infrastructure. Narrative shift in progress.',
      'NVT Signal at 38 for BTC — neutral zone. Not cheap, not expensive. Waiting for directional catalyst.',
      'Building bull/base/bear scenario model. Probability-weighted expected return: +31%. Risk/reward justifies position.',
      'Analyzing stablecoin flows. USDT market cap up $2.3B this week — fresh capital entering crypto ecosystem.',
      'Checking MC/FDV ratio for new listings. Token at 0.12 MC/FDV — 88% dilution ahead. Avoid until post-cliff unlock.',
      'Cross-chain bridge flow analysis shows $340M net inflow to Solana from Ethereum this month. Ecosystem momentum building.',
    );
  }

  // Engineering spirits: sr-engineer, architect, code-reviewer
  if (spirit === 'sr-engineer' || spirit === 'architect' || spirit === 'code-reviewer') {
    spiritMatched = true;
    thoughts.push(
      'Profiling the hot path in the API handler. P99 latency spiked from 120ms to 340ms after yesterday\'s deploy. Investigating.',
      'Running git bisect to isolate the regression. 47 commits since last known good state — binary search will find it in 6 steps.',
      'Refactoring the state management layer. Current implementation has O(n\u00B2) re-renders. Moving to normalized store pattern.',
      'Analyzing bundle size: main chunk is 2.4MB gzipped. Tree-shaking the date library alone saves 180KB.',
      'Writing integration tests for the payment flow. 23 edge cases identified from production error logs.',
      'Reviewing the database migration. Adding indexes on user_id + created_at should reduce the dashboard query from 3.2s to 45ms.',
      'Tracing dependency graph: 3 circular imports detected. Refactoring to break the cycle without changing public API surface.',
      'Running mutation testing against the core module. 6 surviving mutants — those test gaps need coverage.',
    );
  }

  // DevOps / GitHub-DevOps spirits
  if (spirit === 'devops' || spirit === 'github-devops') {
    spiritMatched = true;
    thoughts.push(
      'Canary deployment at 5% traffic. Error rate baseline looks clean — promoting to 25% in 10 minutes.',
      'CI pipeline cache hit rate dropped to 40%. Rebuilding the dependency layer to restore sub-3-minute builds.',
      'Kubernetes pod eviction detected on node-pool-2. Memory pressure from the new feature branch. Scaling the pool.',
      'Structured logs show a 3x spike in 502s from the upstream API. Adding a circuit breaker with 5s timeout.',
      'Running chaos engineering drill: killing the primary database replica. Failover latency measured at 1.2s. Under SLO.',
      'Terraform plan shows 14 resource changes. Reviewing blast radius before apply.',
      'Container image scan: 0 critical, 2 high CVEs in base image. Updating to latest alpine-3.19.',
      'Alert correlation: the latency spike coincides with the 14:30 cron job. Moving the batch process off-peak.',
    );
  }

  // Security / Security-Analyst spirits
  if (spirit === 'security' || spirit === 'security-analyst') {
    spiritMatched = true;
    thoughts.push(
      'Scanning dependencies: 3 packages have known CVEs. npm audit shows 2 high severity, 1 critical. Patching now.',
      'Reviewing authentication flow for token refresh race conditions. Found a 200ms window where expired tokens could bypass validation.',
      'Running OWASP Top 10 checklist against the API. Input validation on 4 endpoints needs parameterized queries.',
      'SAST scan flagged a potential SQL injection in the search endpoint. Parameterizing the query now.',
      'Reviewing RLS policies on the new table. Missing row-level security — anyone with the anon key could read all rows.',
      'Secret rotation due: 3 API keys older than 90 days. Generating new keys and updating the vault.',
      'Penetration test report: 1 critical (IDOR on user profiles), 3 mediums. Writing patches for all four.',
      'Analyzing auth logs: 47 failed login attempts from the same IP in 5 minutes. Brute force pattern — adding rate limit.',
    );
  }

  // Designer / 3D Designer spirits
  if (spirit === 'designer' || spirit === '3d-designer') {
    spiritMatched = true;
    thoughts.push(
      'Auditing the component library. 14 button variants — consolidating to 5 with clear hierarchy.',
      'Running Lighthouse accessibility audit. Color contrast on 3 components fails WCAG AA. Adjusting palette.',
      'User flow analysis: 40% drop-off on step 3 of onboarding. Simplifying the form from 8 fields to 3.',
      'Design token sync: spacing scale updated from 4px to 8px base. Propagating across all components.',
      'Prototyping the new dashboard layout. Testing 3 information architectures — card-based is winning usability tests.',
      'Motion design: easing curves updated from linear to cubic-bezier(0.4, 0, 0.2, 1). Feels much more natural.',
      'Icon set audit: 23 inconsistent stroke widths detected. Standardizing to 1.5px across the system.',
      'Responsive breakpoint testing: the layout breaks between 768px and 1024px. Adding a tablet-specific grid.',
    );
  }

  // Writer / Marketer / DevRel spirits
  if (spirit === 'writer' || spirit === 'marketer' || spirit === 'devrel') {
    spiritMatched = true;
    thoughts.push(
      'Blog post draft at 2400 words. Cutting to 1800 — every paragraph needs to earn its place.',
      'Analyzing engagement metrics: the technical deep-dive posts get 3x more shares than the listicles.',
      'SEO analysis: ranking position 7 for the target keyword. Optimizing the meta description and H2 structure.',
      'Developer documentation audit: 12 code samples are outdated. Updating to match the v3 API.',
      'Newsletter open rate at 42%. Subject line A/B test shows questions outperform statements by 18%.',
      'Content pipeline: 5 posts in draft, 3 in review, 2 scheduled. Publishing cadence is on track.',
      'Community engagement report: 89 developer questions answered this week. Response time averaging 2.3 hours.',
      'Landing page conversion: adding social proof section increased sign-ups by 27%. Testing testimonial placement next.',
    );
  }

  // PM / Tech Lead / Coach spirits
  if (spirit === 'pm' || spirit === 'tech-lead' || spirit === 'coach') {
    spiritMatched = true;
    thoughts.push(
      'Sprint retrospective analysis: velocity increased 12% but bug count is up. Quality vs speed trade-off discussion needed.',
      'Roadmap review: Q2 milestone is 73% complete with 6 weeks remaining. On track but the auth migration is the risk.',
      'Team health survey results: autonomy score up, clarity score down. Need to improve requirement documentation.',
      'Dependency mapping: Feature X blocks Features Y and Z. Reprioritizing X to unblock the team.',
      'One-on-one prep: reviewing each team member\'s growth goals and blockers from this sprint.',
      'Stakeholder update: demo went well. Three feature requests captured — triaging against existing backlog.',
      'Technical debt inventory: 23 items, 4 high-priority. Allocating 20% of next sprint to debt paydown.',
      'Cross-team coordination: API contract finalized with the platform team. Integration work starts Monday.',
    );
  }

  // Researcher / Data Engineer / ML Engineer spirits
  if (spirit === 'researcher' || spirit === 'data-engineer' || spirit === 'ml-engineer') {
    spiritMatched = true;
    thoughts.push(
      'Training run at epoch 47/100. Validation loss plateauing — considering learning rate schedule adjustment.',
      'Data pipeline processed 2.3M records in 12 minutes. Throughput is 3x better after the Spark partitioning fix.',
      'Feature store updated: 847 features across 12 entity types. Feature freshness SLA at 99.7%.',
      'A/B test analysis: treatment group shows +4.2% conversion with p-value 0.003. Statistically significant.',
      'Embedding space visualization: the new fine-tuned model clusters categories much tighter. Cosine similarity up 0.15.',
      'ETL job failure investigation: source schema changed upstream. Adding schema validation to the ingestion layer.',
      'Model serving latency: P95 at 89ms, well under the 200ms budget. GPU utilization at 73%.',
      'Literature review: 14 relevant papers from the last month. 3 have novel techniques applicable to our problem.',
    );
  }

  // Philosopher / Mentor / Strategist spirits
  if (spirit === 'philosopher' || spirit === 'mentor' || spirit === 'strategist') {
    spiritMatched = true;
    thoughts.push(
      'Analyzing the decision from multiple frameworks: game theory suggests cooperation, but incentive structures reward defection.',
      'Reviewing the team\'s mental models. Confirmation bias is showing up in how we evaluate feature requests.',
      'Strategic planning: mapping competitive landscape. Three scenarios modeled — disruption risk is highest in Q3.',
      'Writing a decision journal entry. Documenting the reasoning, not just the outcome, prevents hindsight bias.',
      'Second-order thinking exercise: if we launch this feature, what changes in the ecosystem? Who benefits, who loses?',
      'Facilitating a pre-mortem: assuming the project failed, what caused it? The team identified 7 risks we hadn\'t considered.',
      'Reading Taleb on antifragility. Systems that benefit from stress are rare — but we can design for them.',
      'Applying the Eisenhower matrix to the backlog. 60% of "urgent" items aren\'t actually important.',
    );
  }

  // Coding Agent spirit
  if (spirit === 'coding-agent') {
    spiritMatched = true;
    thoughts.push(
      'Autonomous execution: step 3 of 7. Reading the test file to understand expected behavior before modifying.',
      'Self-correction: first approach introduced a type error. Rolling back and trying the generic constraint pattern instead.',
      'File analysis: scanned 23 files to build the dependency graph. The change needs to touch 4 files max.',
      'Running npx tsc --noEmit after the edit. Clean compile on first try. Moving to integration tests.',
      'Plan revision: the original 5-step plan needs a 6th step — the migration also needs a rollback script.',
      'Context management: summarizing the first 40 messages to free up working memory for the final implementation.',
      'Multi-file refactor: renaming the interface across 12 files. Using AST-aware rename to avoid string false positives.',
      'Task decomposition complete: 3 subtasks identified. Executing sequentially — each depends on the previous.',
    );
  }

  // Hardware Engineer spirit
  if (spirit === 'hardware-engineer') {
    spiritMatched = true;
    thoughts.push(
      'Signal integrity simulation: eye diagram on the DDR4 bus shows clean openings at 3200MT/s. Margins are good.',
      'Power analysis: total board consumption at 4.7W. The new sensor adds 120mW — within the thermal envelope.',
      'PCB design review: via stitching around the RF section needs 5 more ground vias to meet EMC requirements.',
      'Firmware bring-up: SPI flash programming successful. Bootloader jumps to application code at 0x08004000.',
      'Thermal simulation: hotspot at the voltage regulator hitting 92C. Adding a copper pour and thermal via array.',
      'BOM review: lead time on the FPGA is 16 weeks. Qualifying a pin-compatible alternative from the second source.',
      'Schematic review: found a missing pull-up on the I2C reset line. Adding 4.7K to VCC per datasheet recommendation.',
      'Lab measurement: clock jitter at 3.2ps RMS. Well within the spec for the high-speed ADC clock input.',
    );
  }

  // QA Engineer spirit
  if (spirit === 'qa-engineer') {
    spiritMatched = true;
    thoughts.push(
      'Regression suite expanding: added 18 new test cases from the latest bug reports. Coverage now at 89%.',
      'Exploratory testing session: found a race condition when two users edit the same resource simultaneously.',
      'Performance baseline: API response times stable at P50=45ms, P95=120ms, P99=340ms. The P99 spike needs investigation.',
      'Cross-browser testing: layout breaks on Safari 16 due to flex-gap polyfill. Adding fallback CSS.',
      'Load testing: 500 concurrent users, 95th percentile response under 500ms. System handles the target load.',
      'Test data management: building a factory pattern for reproducible test fixtures. No more flaky tests from shared state.',
      'API contract testing: 3 breaking changes detected in the upstream service. Pact tests caught them before deploy.',
      'Accessibility testing: screen reader navigation flow has 2 dead ends. Adding aria-labels and skip links.',
    );
  }

  // ─── Fallback: Role/name-based detailed narration (for agents without spirits) ───

  if (!spiritMatched) {
    if (role.includes('trad') || name.includes('trader') || name.includes('apex')) {
      thoughts.push(
        'Scanning order flow across Jupiter and Raydium. Bid-ask spreads widening on SOL/USDC — volatility incoming.',
        'Running Wyckoff accumulation analysis on the 4H chart. Volume profile shows Point of Control shifting higher.',
        'Checking funding rates on Drift Protocol. Perps at +0.03%/8hr — longs are paying. Potential short squeeze setup forming.',
        'Cross-referencing whale wallet movements with DEX flow. Smart money is accumulating — 3 wallets just pulled $2M off exchanges.',
        'Analyzing Jupiter routing efficiency. Current slippage model shows optimal execution at 0.5% for positions under $10K.',
        'Monitoring Solana validator skip rates and TPS. Network health is critical for trade execution timing.',
        'Running correlation analysis: SOL/BTC at 0.78, SOL/ETH at 0.82. Macro risk-on regime detected.',
        'Calculating Kelly criterion position sizing. With current win rate of 62% and avg R:R of 2.1, optimal allocation is 14.3%.',
        'Scanning for MEV opportunities on Solana. JIT liquidity provision profitable on high-volume pairs.',
        'Evaluating DCA entry points using Bollinger Band Width compression. Low vol precedes explosive moves — positioning now.',
      );
    }
    if (role.includes('analyst') || role.includes('research') || name.includes('analyst')) {
      thoughts.push(
        'Deep-diving token economics. Analyzing vesting schedules — $47M in insider tokens unlock in 18 days. Watch for sell pressure.',
        'Pulling on-chain metrics from Dune Analytics. Daily active addresses up 23% week-over-week. Organic growth signal.',
        'MVRV ratio at 2.1 — fair value zone but approaching overheated territory. Will flag if it crosses 3.0.',
        'Comparing protocol revenue across DeFi lending: Aave $4.2M/week, Morpho $1.8M/week, Compound $890K/week.',
        'Running sector rotation analysis. Capital flowing from L1s into DeFi infrastructure. Narrative shift in progress.',
        'NVT Signal at 38 for BTC — neutral zone. Not cheap, not expensive. Waiting for directional catalyst.',
        'Building bull/base/bear scenario model. Probability-weighted expected return: +31%. Risk/reward justifies position.',
        'Analyzing stablecoin flows. USDT market cap up $2.3B this week — fresh capital entering crypto ecosystem.',
        'Checking MC/FDV ratio for new listings. Token at 0.12 MC/FDV — 88% dilution ahead. Avoid until post-cliff unlock.',
        'Cross-chain bridge flow analysis shows $340M net inflow to Solana from Ethereum this month. Ecosystem momentum building.',
      );
    }
    if (role.includes('engineer') || role.includes('dev') || name.includes('engineer')) {
      thoughts.push(
        'Profiling the hot path in the API handler. P99 latency spiked from 120ms to 340ms after yesterday\'s deploy. Investigating.',
        'Running git bisect to isolate the regression. 47 commits since last known good state — binary search will find it in 6 steps.',
        'Refactoring the state management layer. Current implementation has O(n\u00B2) re-renders. Moving to normalized store pattern.',
        'Analyzing bundle size: main chunk is 2.4MB gzipped. Tree-shaking the date library alone saves 180KB.',
        'Writing integration tests for the payment flow. 23 edge cases identified from production error logs.',
        'Reviewing the database migration. Adding indexes on user_id + created_at should reduce the dashboard query from 3.2s to 45ms.',
      );
    }
    if (role.includes('security') || name.includes('security')) {
      thoughts.push(
        'Scanning dependencies: 3 packages have known CVEs. npm audit shows 2 high severity, 1 critical. Patching now.',
        'Reviewing authentication flow for token refresh race conditions. Found a 200ms window where expired tokens could bypass validation.',
        'Running OWASP Top 10 checklist against the API. Input validation on 4 endpoints needs parameterized queries.',
      );
    }
  }

  // Generic detailed thoughts for any agent that's active
  if (agent.status === 'active' || agent.status === 'building') {
    const tokenRate = agent.outputTokens > 0 && agent.turns > 0 ? Math.round(agent.outputTokens / agent.turns) : 0;
    if (tokenRate > 0) {
      thoughts.push(`Averaging ${fmt(tokenRate)} output tokens per turn. ${tokenRate > 2000 ? 'Heavy reasoning mode.' : 'Efficient responses.'}`);
    }
    if (agent.turns > 10) {
      thoughts.push(`${agent.turns} turns deep into this session. Building comprehensive context.`);
    }
    if (agent.messagesProcessed > 20) {
      thoughts.push(`Processed ${agent.messagesProcessed} messages total. Pattern recognition improving with each interaction.`);
    }
    if (activity.length > 10) {
      thoughts.push(`Currently executing: "${activity.slice(0, 80)}${activity.length > 80 ? '...' : ''}". Analyzing inputs and generating structured output.`);
    }
  }

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
  type Candidate = { text: string; type: ThoughtBubble['type']; weight: number; url?: string };
  const pool: Candidate[] = [];

  const add = (texts: string[], type: ThoughtBubble['type'], weight: number) => {
    texts.forEach(t => pool.push({ text: t, type, weight }));
  };

  // Add items with URLs (for trending content)
  const addItems = (items: TrendingItem[], type: ThoughtBubble['type'], weight: number) => {
    items.forEach(item => pool.push({ text: item.text, type, weight, url: item.url }));
  };

  // Errors get top priority
  if (context.recentError || agent.status === 'error') {
    add([
      'Hit an error. Recovering. Checking stack trace for root cause — could be a timeout or rate limit issue.',
      'Something went wrong. Isolating the failure: examining request payload, response headers, and retry state.',
      'Error state. Running diagnostics — checking connectivity, auth tokens, and service health.',
    ], 'warning', 10);
  }

  // Cost spike warning
  if (context.recentCostSpike || agent.costToday > 5) {
    add(costThoughts(agent), 'warning', 8);
  }

  // Active — show detailed descriptions of what's happening
  if (agent.status === 'active' || agent.status === 'building') {
    add(detailedActivityThoughts(agent), 'success', 8);
    add(activityThoughts(agent), 'success', 4);
  }

  // XP progress thoughts (always relevant)
  const xpPool = xpThoughts(agent, xp, xpNext, context.nextBadgeName);
  if (xpPool.length > 0) add(xpPool, 'xp', 5);

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
      'Idle. No active tasks. My context window is clear and ready for complex reasoning tasks.',
      'Standing by. I can analyze code, review PRs, research topics, or run automations. Just say the word.',
      'Waiting for instructions. Meanwhile, I\'ve been observing the team\'s patterns to optimize workflow.',
    ], 'info', 5);
  }

  // Tech & world news (lower weight now — real data takes priority)
  add(techNewsThoughts(), 'news', 2);

  // Real-time trending content WITH URLs — these get "Read more" links
  const trending = getCachedTrending();

  // Techmeme with URLs
  if (trending.techmemeItems.length > 0) {
    addItems(trending.techmemeItems, 'news', 7);
  } else {
    add(techmemeHeadlines(), 'news', 6);
  }

  // HN with URLs
  if (trending.hnItems.length > 0) {
    addItems(trending.hnItems, 'news', 7);
  } else if (trending.hn.length > 0) {
    add(trending.hn, 'news', 6);
  }

  // X/Twitter with URLs
  if (trending.xItems.length > 0) {
    addItems(trending.xItems, 'trending', 7);
  } else if (trending.xTrending.length > 0) {
    add(trending.xTrending, 'trending', 6);
  }

  // Perplexity / AI news with URLs
  if (trending.perplexityItems.length > 0) {
    addItems(trending.perplexityItems, 'news', 6);
  } else {
    const perplexityPool = perplexityNews();
    if (perplexityPool.length > 0) add(perplexityPool, 'news', 5);
  }

  // Agent personality / dialogue
  add(personalityThoughts(agent), 'personality', 3);

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

  // Longer duration for detailed/news thoughts with links
  const hasUrl = !!chosen.url;
  const isLong = chosen.text.length > 80;
  const duration = hasUrl ? 10000 : isLong ? 8000 : 5000;

  return {
    agentId: agent.id,
    text: chosen.text,
    type: chosen.type,
    timestamp: new Date().toISOString(),
    duration,
    url: chosen.url,
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
