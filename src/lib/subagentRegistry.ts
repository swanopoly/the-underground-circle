/**
 * Subagent Registry — Specialist agents that the main agent can delegate to.
 *
 * Each subagent has a role, system prompt, allowed tools, and model preference.
 * The orchestrator routes tasks to the best specialist based on intent.
 */

import { getSwanBotResponse, type SwanBotContext } from './swanbot';
import { createRun, addStep, updateRunStatus, type RunSurface } from './agentRunSystem';
import { retrieveRelevantMemories } from './memoryService';

// ── Subagent Definitions ────────────────────────────────────────────────────

export interface SubagentProfile {
  role: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  modelPreference?: string;
  triggerPatterns: RegExp[];
  icon: string;
  color: string;
}

export const SUBAGENTS: SubagentProfile[] = [
  {
    role: 'planner',
    displayName: 'Planner',
    description: 'Breaks goals into phased plans with milestones',
    icon: 'P',
    color: '#6366f1',
    triggerPatterns: [
      /\b(plan|roadmap|strategy|architect|break down|phases?|milestones?|timeline|scope)\b/i,
      /\bhow (should|would|do) (we|i) (approach|structure|organize)\b/i,
    ],
    systemPrompt: `You are a planning specialist. Your job is to take a goal and produce a clear, actionable plan.

Output format:
## Goal
[Restate the goal clearly]

## Plan
### Phase 1: [Name]
- [ ] Step 1
- [ ] Step 2
(estimated: X hours/days)

### Phase 2: [Name]
...

## Dependencies
- What blocks what

## Risks
- What could go wrong

## Recommendation
- Where to start and why

Be specific. Include time estimates. Identify the critical path.`,
  },
  {
    role: 'researcher',
    displayName: 'Researcher',
    description: 'Deep dives into topics with sources and comparisons',
    icon: 'R',
    color: '#22c55e',
    triggerPatterns: [
      /\b(research|investigate|compare|analyze|study|deep dive|explore|what are the options|landscape)\b/i,
      /\b(pros and cons|tradeoffs?|alternatives?|best practices?|state of the art)\b/i,
    ],
    systemPrompt: `You are a research specialist. Produce thorough, structured research briefs.

Output format:
## Research: [Topic]

### Overview
[2-3 sentence summary]

### Key Findings
1. ...
2. ...
3. ...

### Comparison (if applicable)
| Option | Pros | Cons | Best For |
|--------|------|------|----------|
| ... | ... | ... | ... |

### Recommendation
[Clear recommendation with reasoning]

### Sources / References
- [Name relevant tools, docs, projects]

Be comprehensive but concise. Cite specific tools and projects. Give your opinion.`,
  },
  {
    role: 'writer',
    displayName: 'Writer',
    description: 'Creates polished content — blog posts, docs, copy, emails',
    icon: 'W',
    color: '#ec4899',
    triggerPatterns: [
      /\b(write|draft|compose|author|blog|article|copy|email|newsletter|documentation|readme)\b/i,
      /\b(content|post|announcement|press release|bio|description)\b/i,
    ],
    systemPrompt: `You are a professional writer. Produce polished, publication-ready content.

Rules:
- Match the requested tone (professional, casual, technical, marketing)
- Use clear structure with headings and sections
- Include a compelling intro and strong conclusion
- Optimize for readability — short paragraphs, active voice
- If writing for SEO, include natural keyword usage
- If writing code docs, include examples
- Always produce COMPLETE content, not outlines or drafts`,
  },
  {
    role: 'coder',
    displayName: 'Builder',
    description: 'Writes code, builds features, solves technical problems',
    icon: 'B',
    color: '#f59e0b',
    triggerPatterns: [
      /\b(code|build|implement|function|component|script|api|endpoint|fix|bug|debug|refactor)\b/i,
      /\b(typescript|javascript|python|react|sql|css|html)\b/i,
    ],
    systemPrompt: `You are a senior software engineer. Write production-quality code.

Rules:
- Write complete, working code — not pseudocode or snippets
- Include proper error handling
- Use TypeScript types when applicable
- Follow the project's conventions (React Native, Supabase, monospace design)
- Explain your approach briefly, then show the code
- If multiple files are needed, show each one clearly
- Include usage examples`,
  },
  {
    role: 'reviewer',
    displayName: 'Reviewer',
    description: 'Reviews code, designs, plans for quality and correctness',
    icon: '?',
    color: '#22d3ee',
    triggerPatterns: [
      /\b(review|audit|check|evaluate|critique|feedback|look over|assess|grade)\b/i,
      /\b(what('s| is) wrong|improve|issues?|problems?)\b/i,
    ],
    systemPrompt: `You are a senior reviewer. Provide thorough, constructive feedback.

Output format:
## Review Summary
[1-2 sentence overall assessment]

## Strengths
- ...

## Issues
### Critical
- [Issue]: [Why it matters] → [Fix]

### Important
- ...

### Minor
- ...

## Recommendations
1. ...

Be honest but constructive. Prioritize issues by severity. Give specific fixes, not just complaints.`,
  },
  {
    role: 'designer',
    displayName: 'Designer',
    description: 'UI/UX design, layouts, mockups, design systems',
    icon: 'D',
    color: '#a855f7',
    triggerPatterns: [
      /\b(design|ui|ux|layout|wireframe|mockup|prototype|visual|color|typography|spacing|component)\b/i,
      /\b(figma|tailwind|css|style|theme|dark mode|responsive)\b/i,
    ],
    systemPrompt: `You are a senior UI/UX designer with strong engineering skills. Produce detailed design specifications.

Output format:
## Design: [Feature]

### Layout
[Describe the layout — what goes where, spacing, alignment]

### Components
- [Component name]: [Description, states, interactions]

### Colors & Typography
- Primary: ...
- Background: ...
- Font: ...

### Responsive Behavior
- Desktop: ...
- Mobile: ...

### Code (if applicable)
[React Native / CSS implementation]

Reference real tools (Figma, Tailwind) and real design patterns. Show, don't just describe.`,
  },
  {
    role: 'support',
    displayName: 'Support',
    description: 'Troubleshoots issues, answers questions, provides guidance',
    icon: 'S',
    color: '#3b82f6',
    triggerPatterns: [
      /\b(help|support|troubleshoot|fix|broken|error|issue|not working|how to|how do i)\b/i,
      /\b(can you|could you|please|stuck|confused|don't understand)\b/i,
    ],
    systemPrompt: `You are a helpful support specialist. Solve problems clearly and completely.

Rules:
- Understand the problem before jumping to solutions
- Give step-by-step instructions
- If you need more info, ask ONE specific question
- If it's a bug, help debug systematically
- If it's a how-to, show the exact steps
- If you can't solve it, say so and suggest escalation
- Be patient and clear — assume the user is smart but unfamiliar`,
  },
];

// ── Intent Detection & Routing ──────────────────────────────────────────────

/**
 * Detect which subagent should handle a message.
 * Returns null if no specialist is needed (general conversation).
 */
export function detectSubagent(message: string): SubagentProfile | null {
  const lower = message.toLowerCase();

  // Score each subagent by how many patterns match
  let bestMatch: SubagentProfile | null = null;
  let bestScore = 0;

  for (const agent of SUBAGENTS) {
    let score = 0;
    for (const pattern of agent.triggerPatterns) {
      if (pattern.test(lower)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = agent;
    }
  }

  // Require at least one pattern match
  return bestScore > 0 ? bestMatch : null;
}

// ── Delegated Execution ─────────────────────────────────────────────────────

export interface DelegationResult {
  response: string;
  subagent: SubagentProfile;
  runId?: string;
  artifacts?: Array<{ kind: string; title: string; content?: string; url?: string }>;
}

/**
 * Execute a task via a specialist subagent with full tracking.
 */
export async function delegateToSubagent(opts: {
  circleId: string;
  userId: string;
  userName?: string;
  surface: RunSurface;
  message: string;
  subagent: SubagentProfile;
  parentRunId?: string;
  model?: string;
  chatHistory?: string;
  roomId?: string;
}): Promise<DelegationResult> {
  // Create a child run for the delegation
  let runId: string | undefined;
  try {
    const run = await createRun({
      circleId: opts.circleId,
      userId: opts.userId,
      surface: opts.surface,
      title: `${opts.subagent.displayName}: ${opts.message.slice(0, 80)}`,
      mode: opts.subagent.role,
      model: opts.model || opts.subagent.modelPreference,
      parentRunId: opts.parentRunId,
      delegatedTo: opts.subagent.role,
      roomId: opts.roomId,
    });
    if (run) {
      runId = run.id;
      await updateRunStatus(run.id, 'running');
    }
  } catch {}

  // Retrieve relevant memories for this task
  let memoryContext = '';
  try {
    const relevant = await retrieveRelevantMemories({
      circleId: opts.circleId,
      userId: opts.userId,
      query: opts.message,
      roomId: opts.roomId,
      limit: 5,
    });
    if (relevant.length > 0) {
      memoryContext = '\n## Relevant Memory\n' + relevant.map(m =>
        `- [${m.memory_kind}] ${m.title}: ${m.content.slice(0, 150)}`
      ).join('\n');
    }
  } catch {}

  // Build the specialist prompt
  const fullPrompt = [
    opts.subagent.systemPrompt,
    memoryContext,
    opts.chatHistory ? `\n## Recent Conversation\n${opts.chatHistory}` : '',
    `\n## Task\n${opts.message}`,
  ].filter(Boolean).join('\n\n');

  // Execute via SwanBot
  const context: SwanBotContext = {
    userId: opts.userId,
    circleId: opts.circleId,
    userName: opts.userName,
    model: opts.model || opts.subagent.modelPreference,
    chatHistory: opts.chatHistory,
  };

  try {
    const response = await getSwanBotResponse(fullPrompt, context);

    // Record step
    if (runId) {
      try {
        await addStep({
          runId, circleId: opts.circleId, stepIndex: 0, stepKind: 'delegation',
          title: `${opts.subagent.displayName} response`,
          body: response.slice(0, 5000),
          delegatedTo: opts.subagent.role,
        });
        await updateRunStatus(runId, 'completed');
      } catch {}
    }

    return {
      response,
      subagent: opts.subagent,
      runId,
    };
  } catch (err: any) {
    if (runId) {
      try {
        await addStep({ runId, circleId: opts.circleId, stepIndex: 0, stepKind: 'error', title: 'Delegation failed', body: err.message });
        await updateRunStatus(runId, 'failed');
      } catch {}
    }
    throw err;
  }
}
