// =============================================================================
// AI Wiki Data Layer
// Educational content about AI agents, tools, models, and design techniques.
// Connects to the Schools education section via relatedLessonIds.
// =============================================================================

export type WikiCategory = 'agents' | 'models' | 'frameworks' | 'design' | 'open-source' | 'mcp' | 'foundations' | 'landscape';

export interface WikiArticle {
  id: string;
  title: string;
  subtitle: string;
  category: WikiCategory;
  icon: string;
  color: string;
  content: WikiSection[];
  relatedLessonIds?: string[];
  tags: string[];
}

export interface WikiSection {
  title: string;
  content: string;
  bulletPoints?: string[];
  codeExample?: string;
  tableData?: { headers: string[]; rows: string[][] };
}

export interface WikiCategoryInfo {
  id: WikiCategory;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  articleCount: number;
}

export interface WikiArticleReference {
  id: string;
  title: string;
  subtitle: string;
  category: WikiCategory;
  color: string;
  tags: string[];
}

// =============================================================================
// Categories
// =============================================================================

export const WIKI_CATEGORIES: Omit<WikiCategoryInfo, 'articleCount'>[] = [
  {
    id: 'agents',
    title: 'AI Coding Agents',
    subtitle: 'CLI tools and editors that write code with you',
    icon: '>_',
    color: '#22c55e',
  },
  {
    id: 'models',
    title: 'AI Models',
    subtitle: 'The large language models powering everything',
    icon: 'AI',
    color: '#6366f1',
  },
  {
    id: 'frameworks',
    title: 'Agent Frameworks',
    subtitle: 'SDKs and libraries for building AI agents',
    icon: '{}',
    color: '#f59e0b',
  },
  {
    id: 'design',
    title: 'Design Techniques',
    subtitle: 'Modern UI/UX patterns and visual design',
    icon: '[]',
    color: '#ec4899',
  },
  {
    id: 'open-source',
    title: 'Open Source AI',
    subtitle: 'Running and fine-tuning models on your own hardware',
    icon: 'OS',
    color: '#22d3ee',
  },
  {
    id: 'mcp',
    title: 'MCP Protocol',
    subtitle: 'The Model Context Protocol connecting AI to the world',
    icon: '<>',
    color: '#a855f7',
  },
  {
    id: 'foundations',
    title: 'AI Foundations',
    subtitle: 'History, concepts, and the durable ideas behind modern AI',
    icon: '::',
    color: '#14b8a6',
  },
  {
    id: 'landscape',
    title: 'AI Landscape',
    subtitle: 'Current-state radar reports on what is moving now',
    icon: '>>',
    color: '#84cc16',
  },
];

// =============================================================================
// Articles
// =============================================================================

export const WIKI_ARTICLES: WikiArticle[] = [
  // ===========================================================================
  // FOUNDATIONS
  // ===========================================================================
  {
    id: 'ai-history-foundations',
    title: 'AI History & Foundations',
    subtitle: 'The major eras of AI and the core concepts that still shape modern models and agents.',
    category: 'foundations',
    icon: '::',
    color: '#14b8a6',
    tags: ['history', 'transformers', 'foundations', 'agents'],
    content: [
      {
        title: 'Why Foundations Matter',
        content:
          'An AI wiki cannot only cover what is new. If it does, it becomes a stream of launch notes instead of a durable knowledge system. Understanding symbolic AI, statistical machine learning, deep learning, transformers, foundation models, and the agent era makes modern products much easier to reason about. It also helps you separate what is structural from what is hype.',
        bulletPoints: [
          'Old ideas explain why modern systems behave the way they do',
          'History helps you separate durable progress from temporary hype',
          'Product decisions improve when you understand the underlying era shifts',
        ],
      },
      {
        title: 'The Major Eras',
        content:
          'The broad sequence is symbolic AI, statistical machine learning, deep learning, transformers, foundation models, and then agents. Symbolic AI emphasized hand-authored rules. Statistical learning emphasized data-driven prediction. Deep learning enabled representation learning at scale. Transformers became the dominant architecture for language and many multimodal systems. Foundation models generalized one large model across many tasks. Agents extend those models into systems that can use tools, remember context, and complete work over time.',
        bulletPoints: [
          'Symbolic AI: explicit rules and logic',
          'Statistical ML: learn patterns from data',
          'Deep learning: hierarchical representations',
          'Transformers: attention-first sequence modeling',
          'Foundation models: general-purpose pretrained systems',
          'Agents: tool-using task systems',
        ],
      },
      {
        title: 'The Most Durable Concepts',
        content:
          'Several ideas keep showing up regardless of which provider is winning a given month: transformers, pretraining, post-training, retrieval, tool use, memory, context engineering, and evals. These are the concepts that should stay evergreen in any serious AI knowledge base because they determine what systems can do, how reliable they are, and what kind of infrastructure they need.',
        bulletPoints: [
          'Pretraining builds general capability',
          'Post-training shapes behavior and alignment',
          'Retrieval grounds answers in external context',
          'Tool use turns a model into a more useful system',
          'Evals separate good demos from dependable products',
        ],
      },
      {
        title: 'Why This Matters For Product Builders',
        content:
          'If you understand the foundations, you stop making shallow product mistakes. You do not confuse a fluent answer with a reliable task completion. You do not assume model quality alone will fix missing runtime design. You know when retrieval, tools, approvals, or evals matter more than switching models.',
        bulletPoints: [
          'Good chat output is not the same as good agent execution',
          'Runtime quality matters as much as model quality',
          'Context and tool access shape the product more than many teams expect',
        ],
      },
    ],
  },
  // ===========================================================================
  // LANDSCAPE
  // ===========================================================================
  {
    id: 'ai-landscape-radar',
    title: 'AI Landscape Radar',
    subtitle: 'A current-state view of the most important AI themes, products, and shifts worth tracking now.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    tags: ['radar', 'agents', 'multimodal', 'open-source', 'product'],
    content: [
      {
        title: 'What Matters Most Right Now',
        content:
          'The center of gravity in AI has shifted from simple chatbot comparisons to dependable agent workflows. The highest-signal areas now are coding agents, agent runtime infrastructure, multimodal input and output, browser and computer-use systems, stronger open-weight models, and evaluation-driven reliability.',
        bulletPoints: [
          'Coding agents are now real product categories',
          'Runtime infrastructure matters as much as the model',
          'Multimodal capability is becoming a default expectation',
          'Browser/computer-use systems are moving from novelty toward utility',
        ],
      },
      {
        title: 'Coding Agents',
        content:
          'Coding agents are the clearest example of AI doing end-to-end work today. The leaders are not just autocomplete tools. They read codebases, plan changes, edit files, run commands, execute tests, and increasingly coordinate parallel work. This is one of the most mature and strategically important areas in current AI product design.',
        bulletPoints: [
          'OpenAI Codex',
          'Anthropic Claude Code',
          'Google Gemini CLI',
          'OpenClaw and self-hosted control-plane patterns',
        ],
      },
      {
        title: 'Open Models And Self-Hosting',
        content:
          'Open-weight models continue to matter because they change the deployment and cost landscape. For many workflows, teams now have serious alternatives to fully closed stacks. The families to watch most closely are Llama, Qwen, DeepSeek, Mistral, Gemma, and Phi.',
        bulletPoints: [
          'Open models matter for privacy, cost, and control',
          'The best open-weight families are now good enough for many serious tasks',
          'Model choice should follow workflow and infrastructure needs, not hype alone',
        ],
      },
      {
        title: 'What A Product Team Should Track',
        content:
          'A good AI product research loop should separate stable foundations from fast-moving changes. The stable layer includes transformers, retrieval, tool use, memory, and evals. The fast-moving layer includes top agent products, multimodal workflows, browser-use systems, and open-weight model releases. That split keeps a wiki useful instead of overwhelming.',
        bulletPoints: [
          'Keep foundations evergreen',
          'Track moving fronts in dated radar reports',
          'Map every big shift back to product implications',
        ],
      },
    ],
  },
  {
    id: 'top-coding-agents',
    title: 'Top Coding Agents',
    subtitle: 'A practical overview of the most important coding-agent products and what makes them matter.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['coding agents', 'claude code', 'codex', 'openclaw', 'gemini'],
    content: [
      {
        title: 'Why Coding Agents Matter',
        content:
          'Coding agents are one of the clearest examples of AI doing real end-to-end work. They do more than autocomplete. The best ones read project context, plan changes, edit files, run commands, execute tests, and make their work inspectable. This is one of the most important AI product categories for anyone building serious software tools.',
        bulletPoints: [
          'They operate over real project context',
          'They act instead of only answering',
          'They increasingly support parallel or longer-lived workflows',
        ],
      },
      {
        title: 'The Highest-Signal Products',
        content:
          'The most important coding-agent products right now include Claude Code, OpenAI Codex, Gemini CLI, and OpenClaw-style session and control-plane systems. They differ in product philosophy, ecosystem ties, and runtime design, but they all point toward the same broader shift: software work is moving from static assistance toward agentic execution.',
        bulletPoints: [
          'Claude Code emphasizes terminal-native flow and tooling depth',
          'Codex emphasizes software execution and cloud/local task handling',
          'Gemini CLI emphasizes Gemini access and large-context workflows',
          'OpenClaw emphasizes remote sessions and self-hosted control patterns',
        ],
      },
      {
        title: 'What The Best Ones Share',
        content:
          'The strongest coding-agent systems all make similar design choices. They expose a permission model, operate over project files and commands, maintain useful context, and show enough intermediate work for the user to trust what happened. This makes runtime quality more important than a simple list of headline features.',
        bulletPoints: [
          'Project awareness',
          'Permission and approval boundaries',
          'Actionability',
          'Traceability',
          'Workflow continuity',
        ],
      },
    ],
  },
  {
    id: 'multimodal-browser-agents',
    title: 'Multimodal & Browser Agents',
    subtitle: 'Why images, audio, screenshots, and browser actions are becoming core agent capabilities.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['multimodal', 'browser use', 'vision', 'audio', 'artifacts'],
    content: [
      {
        title: 'Beyond Text-Only Agents',
        content:
          'Many of the most useful modern AI workflows are no longer text-only. Agents increasingly need to interpret screenshots, transcribe audio, answer questions about images, generate assets, and validate behavior in a live browser. These capabilities change what a product can ask an agent to do and what proof an agent can return.',
        bulletPoints: [
          'Vision enables screenshot understanding and OCR',
          'Audio enables transcription and TTS workflows',
          'Image generation supports ideation and asset creation',
          'Browser-use enables validation and UI-only task completion',
        ],
      },
      {
        title: 'Why Browser-Use Matters',
        content:
          'A large amount of real work still happens inside websites and dashboards with weak or nonexistent APIs. Browser-capable agents help bridge that gap. They can navigate pages, collect evidence, validate flows, and sometimes complete repetitive actions that would otherwise require a human to click through them manually.',
        bulletPoints: [
          'Useful for UI validation',
          'Useful for legacy or API-poor systems',
          'Useful for proof-producing workflows',
        ],
      },
      {
        title: 'The Right Product Pattern',
        content:
          'Strong multimodal and browser-capable systems should return typed artifacts and traces, not just prose. That means screenshots, transcripts, extracted text, generated visuals, and step-by-step action logs should be part of the product model. Review checkpoints and validation loops matter just as much as generation itself.',
        bulletPoints: [
          'Typed artifacts build trust',
          'Action traces improve debuggability',
          'Validation loops reduce false confidence',
        ],
      },
    ],
  },
  {
    id: 'model-families-overview',
    title: 'Model Families Overview',
    subtitle: 'A practical map of the main model families shaping the current AI ecosystem.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['models', 'llama', 'gemma', 'mistral', 'deepseek', 'qwen'],
    content: [
      {
        title: 'Why Model Families Matter',
        content:
          'A good AI product strategy requires more than following whichever model is trending. Different model families change what is possible across cost, multimodal support, self-hosting, licensing, and runtime design. The important question is not just who is best overall. It is which family best fits the workflow and deployment shape you actually need.',
        bulletPoints: [
          'Capability is only one axis',
          'Cost and licensing matter',
          'Self-hosting and deployment options matter',
          'Model fit depends on workflow, not hype alone',
        ],
      },
      {
        title: 'The Families To Watch',
        content:
          'The most important families to keep tracking include OpenAI and Claude on the closed frontier side, plus Llama, Gemma, Qwen, DeepSeek, Mistral, and Phi on the open or open-weight side. Each family has a different strategic role in the ecosystem and a different practical role for builders.',
        bulletPoints: [
          'OpenAI models matter for frontier tooling and product integration',
          'Claude models matter for strong reasoning and agentic workflows',
          'Llama matters as a major open ecosystem anchor',
          'Gemma matters for Google-backed open development',
          'Qwen, DeepSeek, and Mistral matter heavily for open-weight capability and deployment choice',
        ],
      },
      {
        title: 'How To Compare Them Correctly',
        content:
          'The right comparison questions are simple: can it do the job, what inputs and outputs does it support, how expensive is it, can it be self-hosted, and what constraints come with its license or platform? Builders who focus only on benchmark headlines usually make worse product decisions than builders who compare workflows and infrastructure fit.',
        bulletPoints: [
          'Task fit beats benchmark obsession',
          'Deployment matters as much as raw quality',
          'Open vs closed tradeoffs should be explicit',
        ],
      },
    ],
  },
  {
    id: 'evals-ai-reliability',
    title: 'Evals & AI Reliability',
    subtitle: 'Why evaluation, regression testing, and workflow measurement matter more than AI demos.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['evals', 'reliability', 'benchmarks', 'agents'],
    content: [
      {
        title: 'Why Evals Matter',
        content:
          'Without evaluation, AI products become collections of anecdotes. A model or agent can look impressive in a few examples and still fail badly in production. Evals give teams a structured way to measure quality, compare versions, and prevent regressions from shipping unnoticed.',
        bulletPoints: [
          'Evals turn vibes into evidence',
          'They help catch regressions early',
          'They matter for safety as well as quality',
        ],
      },
      {
        title: 'The Important Layers',
        content:
          'There are multiple useful evaluation layers. Model evals compare broad capabilities. Workflow evals measure whether the actual product flow works. Safety evals measure harmful or policy-breaking behavior. Regression evals measure whether changes made the system worse. Serious AI products need more than one layer.',
        bulletPoints: [
          'Model evals',
          'Workflow evals',
          'Safety evals',
          'Regression evals',
        ],
      },
      {
        title: 'What To Measure For Agents',
        content:
          'For agent systems, practical measures often matter more than headline benchmark scores. Useful measures include task success rate, tool success rate, retry frequency, approval frequency, artifact quality, and how much human rework is still needed after the system says it is done.',
        bulletPoints: [
          'Task success rate',
          'Tool success rate',
          'Approval and retry patterns',
          'Artifact usefulness',
          'Human rework after completion',
        ],
      },
    ],
  },
  {
    id: 'retrieval-context-engineering',
    title: 'Retrieval & Context Engineering',
    subtitle: 'Why many AI failures are really context failures and how better context design fixes them.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['retrieval', 'context', 'embeddings', 'memory', 'rag'],
    content: [
      {
        title: 'Retrieval Vs Context Engineering',
        content:
          'Retrieval is about selecting relevant external information and bringing it into the model context when needed. Context engineering is broader. It is the discipline of deciding what the model sees, in what order, at what level of detail, and under what token and policy constraints. Retrieval is part of context engineering, not the whole thing.',
        bulletPoints: [
          'Retrieval selects useful evidence',
          'Context engineering designs the full input system',
          'Both strongly shape agent quality',
        ],
      },
      {
        title: 'Why It Matters So Much',
        content:
          'Many AI failures come from missing or noisy context rather than weak models. A strong model with the wrong context can still fail badly. Agents are especially context-sensitive because they work across multiple steps, tools, artifacts, and changing task state.',
        bulletPoints: [
          'Bad context can waste even strong models',
          'Agents need stable instructions and dynamic evidence',
          'Context should be layered, not dumped in blindly',
        ],
      },
      {
        title: 'Useful Product Pattern',
        content:
          'A strong context system usually separates stable instructions, dynamic task state, retrieved evidence, and output-aware continuation. That keeps prompts cleaner, makes retrieval more intentional, and helps future runs build on prior artifacts and summaries without collapsing into noise.',
        bulletPoints: [
          'Stable instruction layer',
          'Dynamic task layer',
          'Retrieved evidence layer',
          'Output-aware continuation layer',
        ],
      },
    ],
  },
  {
    id: 'browser-computer-use-ecosystem',
    title: 'Browser & Computer-Use Ecosystem',
    subtitle: 'How agents are moving from text generation into browser automation, screenshots, and interface control.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['browser', 'computer use', 'playwright', 'automation', 'screenshots'],
    content: [
      {
        title: 'Why This Area Matters',
        content:
          'A large amount of real work still happens inside websites, dashboards, and internal tools that do not expose clean APIs. Browser and computer-use systems matter because they let agents interact with those environments directly. This changes agents from pure responders into operators that can gather proof, validate flows, and complete interface-bound tasks.',
        bulletPoints: [
          'Useful for UI-only systems',
          'Useful for product QA and proof',
          'Useful for repetitive browser workflows',
        ],
      },
      {
        title: 'Two Main Modes',
        content:
          'There are two major patterns here. Deterministic browser automation tools, such as Playwright, are strong for repeatable flows and assertions. Computer-use tools are stronger when the task is more visual, less structured, or less predictable. The strongest future products will often combine both modes instead of choosing only one.',
        bulletPoints: [
          'Deterministic automation for repeatability',
          'Model-driven computer use for flexibility',
          'Hybrid systems are often strongest',
        ],
      },
      {
        title: 'The Safety Requirement',
        content:
          'This category is powerful but risky. Browser and computer-use systems need stronger approvals, action traces, and screenshot proof because they can interact with real credentials, real external systems, and real user interfaces. Safety here is mostly a product-design problem, not just a model problem.',
        bulletPoints: [
          'Approval gates matter',
          'Action logging matters',
          'Proof artifacts matter',
        ],
      },
    ],
  },
  {
    id: 'enterprise-agent-platforms',
    title: 'Enterprise Agent Platforms',
    subtitle: 'What enterprise agent systems optimize for beyond raw model quality.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['enterprise', 'copilot studio', 'agentforce', 'governance'],
    content: [
      {
        title: 'What Enterprise Teams Need',
        content:
          'Enterprise agent platforms are not only about impressive responses. They are about governance, integration, deployment control, analytics, approvals, and safe connections to real business systems. This is what makes enterprise agent design meaningfully different from consumer AI products.',
        bulletPoints: [
          'Governance',
          'Integration depth',
          'Analytics and observability',
          'Deployment and review control',
        ],
      },
      {
        title: 'The Core Platform Pattern',
        content:
          'The strongest enterprise platforms increasingly treat agents as bundles of instructions, knowledge sources, tools, flows, and approval boundaries. That structure matters because it separates grounded knowledge from action-taking capability and gives admins clearer control over what an agent can really do.',
        bulletPoints: [
          'Instructions',
          'Knowledge sources',
          'Tools and connectors',
          'Flows and approvals',
        ],
      },
      {
        title: 'Why It Matters To Builders',
        content:
          'Enterprise systems show that serious AI products need explicit capabilities, explicit knowledge boundaries, and measurable outcomes. That lesson applies even outside the enterprise. The same structure usually improves community, productivity, and team-workflow products too.',
        bulletPoints: [
          'Make capabilities explicit',
          'Separate knowledge from actions',
          'Track outcomes, not just outputs',
        ],
      },
    ],
  },
  {
    id: 'ai-safety-permission-patterns',
    title: 'AI Safety & Permission Patterns',
    subtitle: 'How strong AI products govern access, approvals, isolation, and trust.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['safety', 'permissions', 'approvals', 'trust', 'guardrails'],
    content: [
      {
        title: 'The Real Safety Question',
        content:
          'The real safety problem for agents is not just what they can say. It is what they can access, execute, mutate, and publish. That makes permission design a product-level system, not just a policy checkbox. Strong agent products govern capability, approvals, isolation, and traceability together.',
        bulletPoints: [
          'Safety is about access and action, not just content',
          'Permissions should match risk',
          'Traceability builds trust',
        ],
      },
      {
        title: 'The Key Layers',
        content:
          'The most important safety layers are capability scoping, approval tiers, isolation, traceability, and recovery. A good system decides which tools are active, which actions need approval, which environments are isolated, and how a user can inspect or undo what happened.',
        bulletPoints: [
          'Capability scoping',
          'Approval tiers',
          'Isolation',
          'Traceability',
          'Recovery',
        ],
      },
      {
        title: 'Why This Matters For Agents',
        content:
          'As agents get stronger, invisible execution becomes less acceptable. Users need clear boundaries and visible proof. The best products therefore shift trust away from hidden reasoning and toward visible actions, artifacts, and checks.',
        bulletPoints: [
          'Proof before trust',
          'Risk-based approvals',
          'Environment-specific guardrails',
        ],
      },
    ],
  },
  {
    id: 'open-source-model-serving-stack',
    title: 'Open Source Model Serving Stack',
    subtitle: 'How builders actually run models with open serving layers such as vLLM and TGI.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['serving', 'vllm', 'tgi', 'inference', 'self-hosting'],
    content: [
      {
        title: 'Why Serving Matters',
        content:
          'Model quality gets most of the attention, but the serving layer determines whether those models are practical. It shapes latency, throughput, observability, API compatibility, and deployment control. For product builders, serving is where model choice becomes operations.',
        bulletPoints: [
          'Latency and throughput matter',
          'API compatibility matters',
          'Operations matter',
        ],
      },
      {
        title: 'vLLM And TGI',
        content:
          'vLLM is one of the most important current open serving layers because it supports offline and online inference and exposes OpenAI-compatible serving. Hugging Face Text Generation Inference remains historically important, but the official Hugging Face docs now note that TGI is in maintenance mode and point developers toward engines such as vLLM and SGLang.',
        bulletPoints: [
          'vLLM is strategically important',
          'OpenAI-compatible serving reduces integration friction',
          'TGI is still useful context but no longer the center of future momentum',
        ],
      },
      {
        title: 'What Builders Should Evaluate',
        content:
          'The important questions are simple: can it serve the models you need, does it support your hardware, how easy is it to operate, and how much lock-in or integration friction does it create? Those questions matter more than chasing whichever engine sounds newest.',
        bulletPoints: [
          'Model support',
          'Hardware fit',
          'Operational complexity',
          'Future ecosystem direction',
        ],
      },
    ],
  },
  {
    id: 'design-to-code-figma-mcp',
    title: 'Design-to-Code & Figma MCP',
    subtitle: 'How AI agents are closing the loop between structured design context and implementation.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['figma', 'mcp', 'design-to-code', 'ui', 'implementation'],
    content: [
      {
        title: 'Why This Shift Matters',
        content:
          'Design-to-code is moving from screenshot interpretation toward structured design understanding. The more agents can read components, variables, layout data, and design-system structure directly, the less they need to guess from flat images and the more reliably they can implement real interfaces.',
        bulletPoints: [
          'Structured design context is stronger than screenshot-only context',
          'Design systems should stay the source of truth',
          'Design and code loops are getting tighter',
        ],
      },
      {
        title: 'Why Figma MCP Matters',
        content:
          'Figma MCP is one of the clearest official examples of this direction. Its documented workflows emphasize giving agents access to components, variables, layout information, and even write capabilities. That means design-aware agents can work from real system structure and not just visual approximation.',
        bulletPoints: [
          'Read structured design context',
          'Support implementation workflows',
          'Enable some write-back into design tooling',
        ],
      },
      {
        title: 'The Right Product Pattern',
        content:
          'The strongest design-to-code systems combine structured context, visual validation, and a bidirectional loop between design and implementation. The product goal should not just be code generation. It should be keeping design and code aligned over time.',
        bulletPoints: [
          'Structured context',
          'Visual checks',
          'Bidirectional design/code workflows',
        ],
      },
    ],
  },
  {
    id: 'ai-support-agent-patterns',
    title: 'AI Support-Agent Patterns',
    subtitle: 'How strong support agents combine grounded knowledge, escalation, and workflow handling.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['support', 'agentforce', 'routing', 'escalation', 'help'],
    content: [
      {
        title: 'Why Support Matters',
        content:
          'Support is one of the clearest places where AI either proves itself or breaks trust. Good support agents need grounded knowledge, workflow awareness, escalation rules, and continuity across channels. They are not just FAQ bots. They are case-handling and routing systems.',
        bulletPoints: [
          'Knowledge matters',
          'Escalation matters',
          'Continuity matters',
        ],
      },
      {
        title: 'The Key Pattern',
        content:
          'The strongest support systems combine a knowledge layer with a workflow layer. The knowledge layer answers questions. The workflow layer routes cases, requests more information, escalates to humans, and opens follow-up tasks. Without both, support agents stay shallow.',
        bulletPoints: [
          'Knowledge and workflow should be separate concepts',
          'Escalation should be first-class',
          'Summaries and handoff artifacts improve continuity',
        ],
      },
      {
        title: 'Why It Matters For Product Builders',
        content:
          'Support agents force teams to take grounding, trust, and measurement seriously. They are useful because they sit close to real user pain and real operational cost. That makes them one of the most important practical agent categories to study.',
        bulletPoints: [
          'Good support design improves both user experience and operations',
          'Support agents reveal where your runtime and knowledge design are weak',
        ],
      },
    ],
  },
  {
    id: 'multimodal-media-tooling',
    title: 'Multimodal Media Tooling',
    subtitle: 'How modern AI systems work with images, audio, transcripts, and reusable media artifacts.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['media', 'hf', 'image', 'audio', 'transcription'],
    content: [
      {
        title: 'Why Media Tooling Matters',
        content:
          'AI products are increasingly multimodal, which means they need to create, transform, and understand media rather than only generate text. This includes image generation, transcription, speech, visual understanding, translation, and classification.',
        bulletPoints: [
          'Media workflows change what outputs look like',
          'Typed artifacts become much more important',
          'Multimodal capability expands what agents can actually do',
        ],
      },
      {
        title: 'The Core Product Pattern',
        content:
          'The best multimodal systems expose media outputs as explicit artifacts with provenance, tool identity, and reuse paths. That means image cards, transcript cards, translation cards, and classification cards rather than burying tool output inside plain text.',
        bulletPoints: [
          'Typed artifacts',
          'Provenance',
          'Reusable outputs',
        ],
      },
      {
        title: 'Why Hugging Face Matters Here',
        content:
          'Hugging Face’s Inference Providers ecosystem is useful because it presents a unified interface across many multimodal task types and providers. That makes it easier to think about media capability as a product layer instead of a pile of one-off integrations.',
        bulletPoints: [
          'Unified interface across task types',
          'Broad provider coverage',
          'Good fit for capability-layer thinking',
        ],
      },
    ],
  },
  {
    id: 'agent-memory-systems',
    title: 'Agent Memory Systems',
    subtitle: 'Why long-lived agents need structured memory, reflection, and cross-session continuity.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['memory', 'reflection', 'sessions', 'continuity', 'agents'],
    content: [
      {
        title: 'Why Memory Changes Everything',
        content:
          'Without memory, an agent is mostly a sequence of disconnected turns. With memory, it can preserve continuity, personalize, summarize prior work, and carry lessons forward. That is one of the most important differences between a chatbot and a durable agent system.',
        bulletPoints: [
          'Memory enables continuity',
          'Memory enables personalization',
          'Memory enables long-horizon tasking',
        ],
      },
      {
        title: 'The Main Memory Types',
        content:
          'The most useful distinction is between episodic memory, semantic memory, reflective memory, and working memory. Product builders should avoid collapsing all memory into one flat retrieval store because different memory types have different purposes and different failure modes.',
        bulletPoints: [
          'Episodic memory',
          'Semantic memory',
          'Reflective memory',
          'Working memory',
        ],
      },
      {
        title: 'The Product Lesson',
        content:
          'The real goal is not just to store more. It is to store the right kinds of memory, synthesize useful higher-level summaries, and make it possible to resume or hand off work across sessions and surfaces. Reflection is as important as retrieval.',
        bulletPoints: [
          'Reflection matters',
          'Typed memory layers matter',
          'Cross-session handoff matters',
        ],
      },
    ],
  },
  {
    id: 'managed-agent-memory-patterns',
    title: 'Managed Agent Memory Patterns',
    subtitle: 'How the best agent systems separate startup memory, session state, archival retrieval, and transcript history.',
    category: 'frameworks',
    icon: '{}',
    color: '#14b8a6',
    tags: ['memory', 'managed agents', 'session memory', 'retrieval', 'compaction'],
    content: [
      {
        title: 'The Best Pattern',
        content:
          'The best current agent-memory pattern is not one giant memory blob. It is a layered system: always-visible instruction memory, session working memory, archival memory retrieved on demand, and transcript/log memory kept mainly for audit and recall.',
        bulletPoints: [
          'Instruction memory',
          'Session working memory',
          'Archival retrieval',
          'Transcript and logs',
        ],
      },
      {
        title: 'Why Compaction Matters',
        content:
          'Long-running agents degrade when they keep too much raw history in context. Better systems preserve plans, decisions, open questions, and artifact links while summarizing or dropping noisy traces. Compaction is a core capability, not an optimization.',
        bulletPoints: [
          'Keep plans and decisions',
          'Drop noisy traces',
          'Preserve artifact links',
        ],
      },
      {
        title: 'What Good Product UX Looks Like',
        content:
          'Users should be able to see what memory was loaded, mark something as worth remembering, prevent bad auto-memory, and review project memory in workspace surfaces. Memory quality improves when the system is both managed and visible.',
        bulletPoints: [
          'Show loaded memory sources',
          'Allow remember and forget actions',
          'Review memory at the workspace level',
        ],
      },
    ],
  },
  {
    id: 'agent-memory-ui-compaction',
    title: 'Agent Memory UI & Compaction',
    subtitle: 'How good agent products make memory visible, editable, and compact enough to stay useful over long runs.',
    category: 'frameworks',
    icon: '{}',
    color: '#22d3ee',
    tags: ['memory ui', 'compaction', 'chat ux', 'session state', 'workspace memory'],
    content: [
      {
        title: 'Memory Needs A UI',
        content:
          'Memory quality is not only a backend problem. Users need to see when memory influenced an answer, what was remembered, and how to correct bad memory. Without that, agent memory becomes opaque and trust drops.',
        bulletPoints: [
          'Show memory sources',
          'Expose remember and forget actions',
          'Keep trust high through visibility',
        ],
      },
      {
        title: 'Why Compaction Matters',
        content:
          'Long-running agents get worse if they keep every tool trace and every reply in active context. Better systems preserve plans, decisions, open questions, and artifact links while summarizing noisy traces. Compaction is what keeps session memory useful over time.',
        bulletPoints: [
          'Preserve plans and decisions',
          'Summarize noise',
          'Update session state during the run',
        ],
      },
      {
        title: 'Workspace Review',
        content:
          'Project memory should not live only inside chat bubbles. Workspace surfaces should let teams review instructions, decisions, findings, and candidate memories so durable knowledge stays curated instead of accidental.',
        bulletPoints: [
          'Review memory in project spaces',
          'Promote or retire memories deliberately',
          'Keep long-term knowledge clean',
        ],
      },
    ],
  },
  {
    id: 'semantic-memory-retrieval-privacy',
    title: 'Semantic Memory Retrieval & Privacy',
    subtitle: 'Why good agent memory depends on meaning-based retrieval, strong metadata filters, and private-by-default boundaries.',
    category: 'frameworks',
    icon: '{}',
    color: '#84cc16',
    tags: ['semantic retrieval', 'memory privacy', 'pgvector', 'rls', 'ranking'],
    content: [
      {
        title: 'Retrieval Needs Ranking',
        content:
          'Good agent memory retrieval should not rely only on recency or only on keywords. The strongest pattern is to filter by scope and visibility first, then retrieve semantically, then rerank by importance, confidence, freshness, and scope priority.',
        bulletPoints: [
          'Filter first',
          'Retrieve by meaning',
          'Rerank with metadata',
        ],
      },
      {
        title: 'Privacy Comes First',
        content:
          'Private user memory should not leak through broad shared policies. Strong agent systems enforce privacy both in database row-level security and in application query filters. One without the other is not enough.',
        bulletPoints: [
          'Use RLS correctly',
          'Use explicit app-side filters',
          'Default private memory to owner-only',
        ],
      },
      {
        title: 'The Product Lesson',
        content:
          'A managed-agent product should know not only what to remember, but what to retrieve for this user, in this workspace, for this task, without overloading context or crossing privacy boundaries.',
        bulletPoints: [
          'Task-aware retrieval',
          'Workspace-aware retrieval',
          'Private-by-default memory',
        ],
      },
    ],
  },
  {
    id: 'agent-memory-review-notes',
    title: 'Agent Memory Review Notes',
    subtitle: 'Practical lessons from reviewing a real agent-memory implementation: metadata consistency, private queries, and checkpoint snapshots.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['memory review', 'implementation notes', 'session snapshots', 'private memory'],
    content: [
      {
        title: 'Save Metadata On Insert',
        content:
          'Memory quality drops quickly if importance and retrieval metadata are applied in a fragile second update step. A stronger implementation writes ranking metadata directly when the memory is created.',
        bulletPoints: [
          'Write ranking metadata at insert time',
          'Avoid title-based follow-up updates',
          'Keep retrieval behavior consistent',
        ],
      },
      {
        title: 'Keep User Queries User-Bound',
        content:
          'A private memory system only works if the active user binding survives through review and retrieval paths. Query helpers should not silently drop the user id and fall back to broad shared reads.',
        bulletPoints: [
          'Pass user binding through every query path',
          'Separate shared and private review views',
          'Do not rely on UI filtering alone',
        ],
      },
      {
        title: 'Checkpoint, Don’t Accumulate',
        content:
          'Session summaries should behave like compact snapshots, not an ever-growing list of near-duplicate memory rows. Better systems checkpoint session state and only promote the durable parts into long-term memory.',
        bulletPoints: [
          'Use snapshot checkpoints',
          'Promote only durable information',
          'Keep long-term memory cleaner',
        ],
      },
    ],
  },
  {
    id: 'open-model-deployment-economics',
    title: 'Open Model Deployment Economics',
    subtitle: 'Why open-model cost comparisons depend on serving, utilization, and operations rather than model price alone.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['economics', 'deployment', 'vllm', 'self-hosting', 'cost'],
    content: [
      {
        title: 'The Real Economic Tradeoff',
        content:
          'Open models are attractive, but the economics are not automatically better. The real comparison is between hosted simplicity and self-hosted control. The answer depends on hardware, serving efficiency, utilization, latency needs, privacy requirements, and operational burden.',
        bulletPoints: [
          'Hosted APIs optimize for simplicity',
          'Self-hosting optimizes for control',
          'The economics depend on more than token price',
        ],
      },
      {
        title: 'Why Serving Matters',
        content:
          'The serving layer changes the economics by affecting throughput, batching, quantization, and API compatibility. This is why systems like vLLM are strategically important. They influence whether self-hosting is practical, not just whether it is theoretically possible.',
        bulletPoints: [
          'Serving affects cost per successful task',
          'OpenAI-compatible serving reduces application friction',
          'Operational efficiency matters as much as model choice',
        ],
      },
      {
        title: 'The Better Metric',
        content:
          'For most products, the better economic metric is cost per successful outcome, not cost per token alone. This keeps the analysis tied to real user value instead of abstract pricing comparisons.',
        bulletPoints: [
          'Cost per successful outcome',
          'Not just token price',
          'Not just benchmark quality',
        ],
      },
    ],
  },
  {
    id: 'ai-regulation-policy-tracker',
    title: 'AI Regulation & Policy Tracker',
    subtitle: 'The main policy and governance frameworks shaping how AI products will be built and audited.',
    category: 'landscape',
    icon: '>>',
    color: '#84cc16',
    tags: ['policy', 'regulation', 'eu ai act', 'nist', 'oecd'],
    content: [
      {
        title: 'Why Policy Matters',
        content:
          'AI regulation and governance increasingly affect product design through transparency, logging, approvals, role boundaries, and risk classification. Even before hard legal requirements fully apply, policy ideas often become customer and enterprise expectations.',
        bulletPoints: [
          'Policy becomes product design',
          'Governance requirements shape trust',
          'Documentation and traceability are becoming more important',
        ],
      },
      {
        title: 'The Main Reference Points',
        content:
          'The EU AI Act remains the most important legal reference because it creates a comprehensive risk-based framework. NIST AI RMF remains highly important as a practical operational framework. OECD AI Principles remain a strong high-level governance reference used across many policy discussions.',
        bulletPoints: [
          'EU AI Act',
          'NIST AI RMF',
          'OECD AI Principles',
        ],
      },
      {
        title: 'Why Builders Should Care Early',
        content:
          'The strongest move is to build products with traceability, approvals, risk-aware capabilities, and auditability before those become hard external requirements. Those product choices are useful regardless of future policy shifts.',
        bulletPoints: [
          'Traceability helps now',
          'Approval systems help now',
          'Auditability helps now',
        ],
      },
    ],
  },
  {
    id: 'mcp-overview',
    title: 'MCP Overview',
    subtitle: 'What the Model Context Protocol is, why it matters, and how it fits into modern AI systems.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'protocol', 'tools', 'resources', 'context'],
    content: [
      {
        title: 'What MCP Is',
        content:
          'The Model Context Protocol is an open standard for connecting AI applications to external systems. It gives hosts a standardized way to work with external data sources, tools, and workflows. The protocol is best understood as an integration layer, not the whole product.',
        bulletPoints: [
          'Open standard',
          'Context and capability exchange layer',
          'Not a full product framework by itself',
        ],
      },
      {
        title: 'Why It Matters',
        content:
          'MCP matters because modern AI systems become more useful when they can access real context and external capabilities without requiring a custom integration for every single service. It reduces integration fragmentation and makes capability composition more realistic.',
        bulletPoints: [
          'Reduces one-off integrations',
          'Makes capabilities more composable',
          'Supports richer hosts and agents',
        ],
      },
      {
        title: 'The Key Product Lesson',
        content:
          'The host still owns user experience, permissions, and trust. MCP standardizes the interface between host and capability providers. That distinction is one of the most important things to understand if you want to use the protocol well.',
        bulletPoints: [
          'Hosts own UX',
          'Servers expose capability',
          'Protocol does not replace product design',
        ],
      },
    ],
  },
  {
    id: 'mcp-architecture-participants',
    title: 'MCP Architecture & Participants',
    subtitle: 'How hosts, clients, and servers divide responsibility in the MCP model.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'host', 'client', 'server', 'architecture'],
    content: [
      {
        title: 'The Three Main Roles',
        content:
          'MCP uses a host-client-server architecture. The host is the product the user interacts with. Each client manages one protocol connection to one server. The server exposes capability. This separation is useful because it keeps product concerns separate from protocol concerns.',
        bulletPoints: [
          'Host',
          'Client',
          'Server',
        ],
      },
      {
        title: 'Why This Separation Matters',
        content:
          'The architecture creates clear boundaries between user experience, connection handling, and capability exposure. That makes systems easier to reason about and helps keep servers focused on capability rather than trying to become full products by themselves.',
        bulletPoints: [
          'Hosts own UX and policy',
          'Clients own connections',
          'Servers own exposed capability',
        ],
      },
      {
        title: 'The Product Lesson',
        content:
          'Many teams misunderstand MCP by treating the server like the whole application. The stronger pattern is to keep the host in charge of the user experience and use the protocol as a clean capability layer.',
        bulletPoints: [
          'Do not turn servers into full apps',
          'Keep UX at the host layer',
          'Use the protocol for composition, not confusion',
        ],
      },
    ],
  },
  {
    id: 'mcp-tools-resources-prompts',
    title: 'MCP Tools, Resources, & Prompts',
    subtitle: 'The most important conceptual split in MCP and why it shapes good AI product design.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'tools', 'resources', 'prompts', 'workflow'],
    content: [
      {
        title: 'The Three Building Blocks',
        content:
          'The most important MCP server concepts are tools, resources, and prompts. These are easy to blur together, but they solve different problems. Tools are active functions. Resources are passive context sources. Prompts are reusable workflow templates.',
        bulletPoints: [
          'Tools act',
          'Resources inform',
          'Prompts guide workflows',
        ],
      },
      {
        title: 'Why The Split Matters',
        content:
          'Good AI products are clearer and safer when these concepts stay distinct. Resources are usually better for grounding and read-style access. Tools are where action and risk increase. Prompts create higher-level workflow structure without collapsing everything into raw tool calls.',
        bulletPoints: [
          'Resources help grounding',
          'Tools introduce action and risk',
          'Prompts support reusable flows',
        ],
      },
      {
        title: 'The Design Lesson',
        content:
          'This distinction is not only a protocol detail. It is a product-design advantage. Systems become easier to govern, explain, and scale when context, action, and workflow are represented separately.',
        bulletPoints: [
          'Better governance',
          'Better UX clarity',
          'Better system structure',
        ],
      },
    ],
  },
  {
    id: 'mcp-security-consent',
    title: 'MCP Security & Consent',
    subtitle: 'Why protocol power increases the importance of host-level permission and visibility design.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'security', 'consent', 'permissions', 'trust'],
    content: [
      {
        title: 'Why Security Matters Here',
        content:
          'MCP makes AI systems more useful by connecting them to real capabilities. That makes security and consent more important, not less. The product needs to make it clear what is connected, what can be called, and which actions require approval.',
        bulletPoints: [
          'Capability visibility matters',
          'Consent matters',
          'Approval design matters',
        ],
      },
      {
        title: 'Hosts Carry The Trust Model',
        content:
          'The host is responsible for permission boundaries, user authorization decisions, and the visible trust model. The protocol helps structure capability exchange, but the product still owns the actual safety experience.',
        bulletPoints: [
          'Hosts own policy',
          'Products own trust',
          'Protocol support is not enough by itself',
        ],
      },
      {
        title: 'A Useful Product Pattern',
        content:
          'A strong MCP product should make reads and writes feel different, surface connected servers clearly, and require stronger approval for risky or external tool actions. Local and remote transports should also be treated as different trust surfaces.',
        bulletPoints: [
          'Read vs write should feel different',
          'Remote vs local should feel different',
          'Approval should match risk',
        ],
      },
    ],
  },
  {
    id: 'mcp-playwright-browser-automation',
    title: 'MCP, Playwright, & Browser Automation',
    subtitle: 'How browser automation fits into MCP-style capability design.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['mcp', 'playwright', 'browser', 'automation', 'qa'],
    content: [
      {
        title: 'Why This Pairing Matters',
        content:
          'Playwright is one of the strongest browser automation foundations available, and MCP is one of the strongest protocol patterns for exposing external capabilities to AI hosts. Together they suggest a clean design pattern: deterministic browser power exposed through a standardized capability layer and governed by host-side UX and approvals.',
        bulletPoints: [
          'Playwright gives deterministic browser execution',
          'MCP gives structured capability exposure',
          'The host still owns policy and presentation',
        ],
      },
      {
        title: 'Why Playwright Is Strong',
        content:
          'Playwright is valuable because it supports multiple browsers, strong isolation, parallel execution, traces, and CI-friendly workflows. That makes it a very good substrate for browser-capable agent systems that need repeatability and proof.',
        bulletPoints: [
          'Cross-browser',
          'Isolation',
          'Parallelism',
          'Traces and reports',
        ],
      },
      {
        title: 'The Product Lesson',
        content:
          'The right abstraction is not that MCP replaces browser tooling. It is that browser tooling can be exposed through MCP in a safer and more composable way, while the host stays responsible for approvals, artifacts, and action visibility.',
        bulletPoints: [
          'MCP is the interface layer',
          'Playwright is the execution layer',
          'The host is the trust and UX layer',
        ],
      },
    ],
  },
  // ===========================================================================
  // AGENTS
  // ===========================================================================
  {
    id: 'claude-code',
    title: 'Claude Code',
    subtitle: 'Anthropic\'s agentic CLI that lives in your terminal and writes, edits, and ships code alongside you.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'anthropic', 'claude', 'agent'],
    relatedLessonIds: [
      'ai-tech:ai-coding:ai-coding-assistants',
      'ai-tech:ai-workflow:ai-augmented-research',
    ],
    content: [
      {
        title: 'What Is Claude Code?',
        content:
          'Claude Code is Anthropic\'s official command-line interface for agentic coding. Unlike chat-based assistants, Claude Code operates directly in your terminal with full access to your file system, shell, and development tools. It can read your entire codebase, make multi-file edits, run tests, manage git operations, and even deploy code -- all through natural language conversation. It was built by Anthropic\'s own engineering team, who use it daily to build Claude itself.',
        bulletPoints: [
          'Runs entirely in your terminal -- no browser, no IDE plugin required',
          'Reads and understands your full project context automatically',
          'Makes direct edits to files, runs shell commands, and manages git',
          'Powered by Claude Opus 4.6, Sonnet 4.6, and Haiku 4.5 models',
          'Works on macOS, Linux, and Windows via WSL',
        ],
      },
      {
        title: 'Key Features',
        content:
          'Claude Code packs an enormous feature set designed for professional software development. Hooks let you run custom scripts before or after tool calls -- for example, auto-formatting every file edit or blocking dangerous commands. MCP (Model Context Protocol) integration means Claude Code can connect to external services like GitHub, databases, Slack, and custom APIs through a standardized protocol. Skills are reusable instruction files that teach Claude Code domain-specific workflows. Subagents let Claude Code dispatch parallel workers for large tasks, dramatically speeding up multi-file refactors or code reviews.',
        bulletPoints: [
          'Hooks: PreToolUse, PostToolUse, and Stop hooks for custom automation',
          'MCP Integration: Connect to any MCP server for external tool access',
          'Skills: Markdown-based instruction files for repeatable workflows',
          'Subagents: Parallel task dispatch for large-scale operations',
          'Worktrees: Isolated git worktrees for safe feature development',
          'Plugins: Community-built extensions that add commands, agents, and skills',
        ],
      },
      {
        title: 'Models & Pricing',
        content:
          'Claude Code supports the full Claude model family. By default it uses Opus 4.6 for complex reasoning and Sonnet 4.6 for routine tasks, automatically routing between them. You can also configure it to use Haiku 4.5 for fast, inexpensive operations. Pricing is based on API token usage -- there is no separate subscription fee for Claude Code itself.',
        tableData: {
          headers: ['Model', 'Input (per 1M tokens)', 'Output (per 1M tokens)', 'Best For'],
          rows: [
            ['Opus 4.6', '$15.00', '$75.00', 'Complex architecture, debugging, planning'],
            ['Sonnet 4.6', '$3.00', '$15.00', 'Day-to-day coding, edits, refactoring'],
            ['Haiku 4.5', '$0.80', '$4.00', 'Fast tasks, commit messages, simple queries'],
          ],
        },
      },
      {
        title: 'Getting Started',
        content:
          'Installation is a single npm command. Once installed, navigate to any project directory and type "claude" to start a conversation. Claude Code will automatically detect your project type, read key files, and build context. You can give it natural language instructions like "add error handling to the API routes" or "write tests for the auth module" and it will plan, implement, and verify its changes.',
        codeExample: `# Install globally
npm install -g @anthropic-ai/claude-code

# Start in any project
cd my-project
claude

# Or run a one-shot command
claude -p "explain the architecture of this codebase"

# Use with a specific model
claude --model opus
claude --model sonnet

# Resume previous conversation
claude --continue`,
        bulletPoints: [
          'Run "claude" in any directory to start an interactive session',
          'Use "claude -p" for one-shot non-interactive commands',
          'Use "claude --continue" to resume your last conversation',
          'Configure settings in ~/.claude/settings.json',
        ],
      },
      {
        title: 'Tips & Best Practices',
        content:
          'To get the most out of Claude Code, provide clear context about what you want. Use CLAUDE.md files at the root of your project to give persistent instructions -- coding standards, architecture decisions, and project conventions. Break large tasks into focused requests rather than asking for everything at once. Use the /compact command to summarize long conversations and free up context window. Leverage hooks to enforce your team\'s standards automatically.',
        bulletPoints: [
          'Create a CLAUDE.md file with project-specific instructions and conventions',
          'Use /compact to summarize conversations and reclaim context space',
          'Prefer specific requests: "add input validation to createUser" over "improve the code"',
          'Use git worktrees for risky changes so you can easily discard them',
          'Set up hooks to auto-lint, auto-format, or block unwanted operations',
        ],
      },
    ],
  },
  {
    id: 'codex-cli',
    title: 'OpenAI Codex CLI',
    subtitle: 'OpenAI\'s open-source terminal agent for reading, editing, and executing code locally.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'openai', 'open-source'],
    content: [
      {
        title: 'Overview',
        content:
          'Codex CLI is OpenAI\'s answer to agentic coding in the terminal. Released as a fully open-source project (Apache 2.0 license), it gives developers a lightweight, fast command-line agent powered by OpenAI\'s models. It reads your local codebase, proposes changes, runs commands, and writes files -- all without leaving the terminal. Because it\'s open source, the community can extend, modify, and self-host it.',
        bulletPoints: [
          'Open source under Apache 2.0 -- fork and customize freely',
          'Lightweight Node.js-based CLI with minimal dependencies',
          'Full file system access for reading, writing, and executing',
          'Powered by OpenAI models including GPT-4.1 and o4-mini',
          'Supports sandboxed execution for safe code running',
        ],
      },
      {
        title: 'Architecture & Safety',
        content:
          'Codex CLI uses a multi-layered safety architecture. It offers three approval modes: Suggest (requires approval for everything), Auto Edit (auto-approves file edits but asks before shell commands), and Full Auto (runs everything autonomously). In Full Auto mode, commands execute inside a network-disabled sandbox to prevent unintended side effects. The tool uses a multipass approach -- first planning what to do, then executing changes, then verifying results.',
        bulletPoints: [
          'Three approval modes: Suggest, Auto Edit, Full Auto',
          'Network-disabled sandbox in Full Auto mode prevents accidental damage',
          'Multipass planning: analyze, edit, verify cycle',
          'Platform sandboxing via macOS Seatbelt and Linux namespaces',
        ],
      },
      {
        title: 'Models & Configuration',
        content:
          'By default Codex CLI uses the o4-mini model for a balance of speed and capability. You can switch to GPT-4.1 for more complex tasks or o3 for advanced reasoning. Configuration is stored in a simple config file, and you can set model preferences, approval modes, and custom instructions.',
        codeExample: `# Install
npm install -g @openai/codex

# Set your API key
export OPENAI_API_KEY="sk-..."

# Start interactive session
codex

# One-shot command
codex "refactor the auth middleware to use JWT"

# Use a specific model
codex --model gpt-4.1

# Full auto mode (sandboxed)
codex --approval-mode full-auto "add unit tests for utils/"`,
      },
      {
        title: 'Comparison with Claude Code',
        content:
          'Both Codex CLI and Claude Code are terminal-based coding agents, but they differ in important ways. Claude Code uses Anthropic\'s models and includes a richer feature set with hooks, MCP, subagents, and skills. Codex CLI is simpler and fully open source, making it easier to customize. Claude Code excels at complex multi-step tasks while Codex CLI is snappier for quick edits.',
        tableData: {
          headers: ['Feature', 'Claude Code', 'Codex CLI'],
          rows: [
            ['License', 'Proprietary (free to use)', 'Apache 2.0'],
            ['Models', 'Claude Opus/Sonnet/Haiku', 'GPT-4.1, o4-mini, o3'],
            ['MCP Support', 'Yes', 'No'],
            ['Hooks', 'Yes', 'No'],
            ['Subagents', 'Yes', 'No'],
            ['Sandbox', 'Via worktrees', 'Network-disabled sandbox'],
            ['Auto-approval', '3 levels', '3 levels'],
          ],
        },
      },
    ],
  },
  {
    id: 'gemini-cli',
    title: 'Google Gemini CLI',
    subtitle: 'Google\'s AI-powered command-line tool with a generous free tier and Gemini model access.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'google', 'gemini'],
    content: [
      {
        title: 'Overview',
        content:
          'Gemini CLI is Google\'s entry into the agentic coding space, released as an open-source tool that brings Gemini models directly into your terminal. It stands out with an extremely generous free tier -- 60 model requests per minute and 1,000 requests per day at no cost when authenticated with a personal Google account. It supports Gemini 2.5 Pro with its massive 1 million token context window, making it capable of understanding very large codebases in a single pass.',
        bulletPoints: [
          'Free tier: 60 requests/minute, 1,000 requests/day with Google account',
          'Powered by Gemini 2.5 Pro with 1M token context window',
          'Open source -- community contributions welcome',
          'Supports file editing, shell commands, and code generation',
          'MCP server integration for extended tool access',
        ],
      },
      {
        title: 'Features & Capabilities',
        content:
          'Gemini CLI offers multi-modal input including images, voice, and text. Its massive context window means it can ingest entire project directories without chunking or summarization. It supports tool use including file operations, web search, and code execution. The CLI also integrates with Google\'s broader ecosystem including Vertex AI for enterprise deployments.',
        bulletPoints: [
          'Multi-modal: paste images, screenshots, and diagrams directly',
          'Shell integration for running commands and viewing output',
          'Built-in web search using Google Search grounding',
          'Configurable system instructions via GEMINI.md files',
          'Extension system for custom tools and integrations',
        ],
      },
      {
        title: 'Getting Started',
        content:
          'Installation is straightforward via npm. Authenticate with your Google account to access the free tier, or configure a Gemini API key or Vertex AI credentials for higher rate limits.',
        codeExample: `# Install globally
npm install -g @google/gemini-cli

# Authenticate with Google account (free tier)
gemini auth login

# Start an interactive session
gemini

# One-shot command
gemini -p "explain what this project does"

# With a specific model
gemini --model gemini-2.5-pro`,
      },
      {
        title: 'Pricing Tiers',
        content:
          'Gemini CLI offers one of the most accessible pricing structures for AI coding tools thanks to its free tier. For heavier usage, you can use a paid API key or enterprise Vertex AI credentials.',
        tableData: {
          headers: ['Tier', 'Rate Limit', 'Cost', 'Best For'],
          rows: [
            ['Free (Google Account)', '60 req/min, 1K req/day', '$0', 'Individual developers'],
            ['API Key (Pay-as-you-go)', 'Higher limits', 'Per-token pricing', 'Power users'],
            ['Vertex AI', 'Enterprise limits', 'Enterprise pricing', 'Teams & organizations'],
          ],
        },
      },
    ],
  },
  {
    id: 'cursor',
    title: 'Cursor Editor',
    subtitle: 'The AI-first code editor with deep model integration, agent mode, and multi-file editing.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['ide', 'editor', 'agent'],
    content: [
      {
        title: 'What Is Cursor?',
        content:
          'Cursor is a fork of VS Code rebuilt from the ground up as an AI-first editor. Rather than bolting AI onto an existing editor as a plugin, Cursor integrates AI capabilities at every level of the editing experience. It offers inline completions (like a supercharged autocomplete), a chat sidebar for longer conversations, and Composer -- a multi-file editing agent that can plan and execute changes across your entire project.',
        bulletPoints: [
          'Fork of VS Code -- all your extensions and keybindings work',
          'Tab completion: context-aware suggestions beyond single lines',
          'Chat: sidebar conversation with full codebase context',
          'Composer: multi-file agent mode for complex refactors',
          'Supports Claude, GPT, and Gemini models',
        ],
      },
      {
        title: 'Agent Mode & Composer',
        content:
          'Composer is Cursor\'s flagship feature. In Agent mode, Composer can autonomously plan a task, search your codebase for relevant context, create new files, edit existing ones, run terminal commands, and iterate based on errors. It can handle multi-step tasks like "add authentication to this Next.js app" by creating auth routes, middleware, UI components, and database migrations -- all in a single conversation.',
        bulletPoints: [
          'Autonomous multi-file editing with intelligent planning',
          'Runs terminal commands and uses output to fix issues',
          'Searches codebase for relevant context automatically',
          'Iterates on errors -- if a build fails, it reads the error and fixes it',
          'Supports checkpoints to revert unwanted changes',
        ],
      },
      {
        title: 'Pricing & Plans',
        content:
          'Cursor offers a free tier with limited premium model usage, a Pro plan for individual developers, and a Business plan for teams. The Pro plan is the most popular, offering generous usage of premium models.',
        tableData: {
          headers: ['Plan', 'Price', 'Premium Requests', 'Features'],
          rows: [
            ['Hobby', 'Free', '50/month', 'Basic completions, limited chat'],
            ['Pro', '$20/month', '500/month', 'Full agent mode, all models, unlimited completions'],
            ['Business', '$40/user/month', '500/month', 'Team features, admin controls, SSO'],
          ],
        },
      },
      {
        title: 'Tips for Power Users',
        content:
          'To get the best results from Cursor, learn to use its context system effectively. You can tag specific files or folders with @ mentions in chat, use @codebase to search semantically across your project, and reference documentation with @docs. Setting up a .cursorrules file at the project root gives Cursor persistent context about your coding standards.',
        bulletPoints: [
          'Use @file to include specific files in chat context',
          'Use @codebase for semantic search across your entire project',
          'Create a .cursorrules file for project-specific AI instructions',
          'Use Cmd+K for inline edits without opening chat',
          'Enable "Always search" in Agent mode for better context gathering',
        ],
      },
    ],
  },
  {
    id: 'opencode',
    title: 'OpenCode',
    subtitle: 'SST\'s blazing-fast, open-source terminal agent written in Go with support for 75+ providers.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'open-source', 'sst'],
    content: [
      {
        title: 'Overview',
        content:
          'OpenCode is an open-source AI coding agent built by SST (the team behind the SST framework and Ion). Written entirely in Go, it is extremely fast to install and run -- a single binary with zero runtime dependencies. It supports over 75 AI providers out of the box, including Anthropic, OpenAI, Google, AWS Bedrock, Azure, Groq, Ollama, and many more. Licensed under MIT, it is one of the most flexible and hackable coding agents available.',
        bulletPoints: [
          'Written in Go -- single binary, no Node.js or Python required',
          'MIT licensed -- truly open source with no restrictions',
          'Supports 75+ model providers via OpenRouter, direct APIs, and local models',
          'Beautiful terminal UI with Bubble Tea framework',
          'Built-in LSP integration for code intelligence',
        ],
      },
      {
        title: 'Key Features',
        content:
          'OpenCode brings a polished TUI (Terminal User Interface) experience with file tree browsing, diff previews, and conversation management. It includes built-in tools for file editing, shell execution, and code search. The LSP integration means it can understand your code at a semantic level -- finding references, going to definitions, and understanding type information.',
        bulletPoints: [
          'Rich TUI with conversation history, file browser, and diff views',
          'LSP integration for semantic code understanding',
          'Custom tool support via MCP servers',
          'Conversation branching and session management',
          'Configurable keybindings and themes',
        ],
      },
      {
        title: 'Installation & Usage',
        content:
          'OpenCode can be installed via a single curl command or through package managers. Configuration is done via a simple opencode.json file in your project root.',
        codeExample: `# Install via curl
curl -fsSL https://opencode.ai/install | bash

# Or via go install
go install github.com/sst/opencode@latest

# Start in any project
cd my-project
opencode

# Configuration (opencode.json)
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}`,
      },
      {
        title: 'Provider Support',
        content:
          'One of OpenCode\'s biggest strengths is its provider flexibility. You can switch between cloud APIs and local models seamlessly, or even configure multiple providers and switch between them mid-conversation.',
        tableData: {
          headers: ['Provider Type', 'Examples', 'Setup'],
          rows: [
            ['Direct APIs', 'Anthropic, OpenAI, Google', 'API key in env var'],
            ['Cloud Platforms', 'AWS Bedrock, Azure OpenAI, GCP Vertex', 'Cloud credentials'],
            ['Aggregators', 'OpenRouter, Together AI, Fireworks', 'Single API key'],
            ['Local Models', 'Ollama, llama.cpp, LM Studio', 'Local server URL'],
          ],
        },
      },
    ],
  },
  {
    id: 'windsurf',
    title: 'Windsurf',
    subtitle: 'Codeium\'s AI editor with deep context awareness and the Cascade agent system.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['ide', 'editor'],
    content: [
      {
        title: 'Overview',
        content:
          'Windsurf (formerly Codeium Editor) is an AI-native code editor built by Codeium. Like Cursor, it\'s a VS Code fork with deep AI integration, but Windsurf differentiates itself with Cascade -- an agentic system that maintains awareness of your actions even when you\'re not directly chatting with it. Cascade observes your edits, terminal output, and file navigation to proactively offer relevant suggestions and catch issues.',
        bulletPoints: [
          'VS Code-based editor with full extension compatibility',
          'Cascade: always-on agentic awareness of your coding activity',
          'Flows: combines chat, inline edits, and commands into one experience',
          'Supercomplete: multi-line predictive completions',
          'Free tier available for individual developers',
        ],
      },
      {
        title: 'Cascade System',
        content:
          'Cascade is Windsurf\'s core differentiator. It operates as an always-present pair programmer that understands the full context of what you\'re working on. When you make edits manually, Cascade observes them and updates its understanding. If you encounter an error in the terminal, Cascade notices and offers to help fix it. This proactive awareness means you don\'t have to re-explain context every time you need help.',
        bulletPoints: [
          'Observes your manual edits and terminal activity in real-time',
          'Proactively suggests fixes when errors appear in the terminal',
          'Maintains a memory of your recent actions and project changes',
          'Can execute multi-step tasks autonomously',
          'Supports Claude, GPT, and Codeium\'s own models',
        ],
      },
      {
        title: 'Pricing',
        content:
          'Windsurf offers competitive pricing with a free tier, making it accessible for individuals and small teams.',
        tableData: {
          headers: ['Plan', 'Price', 'Features'],
          rows: [
            ['Free', '$0', 'Basic completions, limited Cascade, community models'],
            ['Pro', '$15/month', 'Unlimited Cascade, premium models, priority support'],
            ['Teams', '$30/user/month', 'Admin controls, usage analytics, SSO'],
          ],
        },
      },
      {
        title: 'Windsurf vs Cursor',
        content:
          'Both are VS Code forks with deep AI, but they take different approaches. Cursor focuses on explicit interaction through Composer, while Windsurf leans into implicit awareness with Cascade. Cursor has broader model support and a larger user community, while Windsurf offers a more seamless "always watching" experience.',
        bulletPoints: [
          'Cursor: explicit AI interaction through Composer and chat',
          'Windsurf: implicit AI awareness that observes your activity',
          'Cursor: larger community and more third-party resources',
          'Windsurf: lower price point and more generous free tier',
          'Both support multi-file editing and terminal integration',
        ],
      },
    ],
  },
  {
    id: 'aider',
    title: 'Aider',
    subtitle: 'The git-aware AI pair programmer that works with any LLM from your terminal.',
    category: 'agents',
    icon: '>_',
    color: '#22c55e',
    tags: ['cli', 'open-source', 'git'],
    content: [
      {
        title: 'Overview',
        content:
          'Aider is one of the original AI coding agents and remains among the most capable. It\'s a Python-based CLI tool that treats git as a first-class citizen -- every AI-generated change is automatically committed with a descriptive message, making it trivially easy to review or revert changes. Aider supports virtually every LLM provider and consistently ranks at the top of coding benchmarks.',
        bulletPoints: [
          'Git-first: every edit becomes a well-described git commit',
          'Works with Claude, GPT, Gemini, DeepSeek, Llama, and dozens more',
          'Multi-file editing with sophisticated diff-based approach',
          'Voice input support -- dictate coding instructions',
          'Architect mode: one model plans, another implements',
        ],
      },
      {
        title: 'Architect Mode',
        content:
          'Aider\'s architect mode is a powerful two-model approach. A "thinking" model (like Claude Opus or o3) analyzes your request, plans the approach, and identifies which files need changes. Then an "editing" model (like Sonnet or GPT-4.1) executes the actual code changes. This division of labor produces better results than using a single model for both planning and editing.',
        bulletPoints: [
          'Thinking model handles planning and architectural decisions',
          'Editing model executes the actual code changes efficiently',
          'Reduces costs by using expensive models only for planning',
          'Produces better results on complex multi-file refactors',
          'Configurable: choose any combination of models',
        ],
      },
      {
        title: 'Getting Started',
        content:
          'Aider is installed via pip and works in any git repository. You can specify which files to work on, and Aider will automatically include relevant context.',
        codeExample: `# Install
pip install aider-chat

# Start with Claude
export ANTHROPIC_API_KEY="sk-..."
aider

# Start with specific files
aider src/auth.ts src/middleware.ts

# Architect mode (Opus plans, Sonnet edits)
aider --architect --model opus --editor-model sonnet

# Voice input
aider --voice

# Use with local models via Ollama
aider --model ollama/deepseek-coder-v2`,
      },
      {
        title: 'Benchmark Performance',
        content:
          'Aider maintains a public leaderboard of model performance on its coding benchmark. This benchmark tests each model\'s ability to make correct code edits across a variety of real-world tasks. Aider consistently achieves top results, validating its diff-based editing approach.',
        tableData: {
          headers: ['Model', 'Aider Benchmark Score', 'Edit Format'],
          rows: [
            ['Claude Opus 4.6', '85.2%', 'diff'],
            ['Claude Sonnet 4.6', '79.8%', 'diff'],
            ['GPT-4.1', '72.1%', 'diff'],
            ['DeepSeek V3', '68.4%', 'whole file'],
            ['Gemini 2.5 Pro', '74.5%', 'diff'],
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // MODELS
  // ===========================================================================
  {
    id: 'claude-models',
    title: 'Claude Model Family',
    subtitle: 'Anthropic\'s Claude models: Opus 4.6 for deep reasoning, Sonnet 4.6 for daily work, Haiku 4.5 for speed.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['anthropic', 'claude'],
    content: [
      {
        title: 'The Claude Lineup',
        content:
          'Anthropic\'s Claude model family consists of three tiers designed for different use cases. Opus 4.6 is the flagship model -- the most intelligent, capable of sustained reasoning over extremely complex tasks. Sonnet 4.6 hits the sweet spot of intelligence and speed, making it ideal for everyday coding, writing, and analysis. Haiku 4.5 is the speed champion, delivering fast responses at low cost for simpler tasks.',
        bulletPoints: [
          'Opus 4.6: Most capable model for complex reasoning and coding',
          'Sonnet 4.6: Balanced performance for everyday tasks',
          'Haiku 4.5: Fast and affordable for simple queries and high-volume tasks',
          'All models share the same safety training and instruction-following capabilities',
          'Extended thinking mode available on Opus and Sonnet for step-by-step reasoning',
        ],
      },
      {
        title: 'Context Windows & Capabilities',
        content:
          'All Claude models support large context windows, enabling them to process entire codebases, lengthy documents, and complex conversations. The models are multimodal, accepting both text and images as input. Extended thinking mode allows the models to "think out loud" before responding, significantly improving performance on math, coding, and logical reasoning tasks.',
        tableData: {
          headers: ['Model', 'Context Window', 'Max Output', 'Extended Thinking'],
          rows: [
            ['Opus 4.6 (1M)', '1,000,000 tokens', '32,000 tokens', 'Yes'],
            ['Opus 4.6', '200,000 tokens', '32,000 tokens', 'Yes'],
            ['Sonnet 4.6', '200,000 tokens', '16,000 tokens', 'Yes'],
            ['Haiku 4.5', '200,000 tokens', '8,192 tokens', 'No'],
          ],
        },
      },
      {
        title: 'Pricing',
        content:
          'Claude\'s pricing scales with capability. Opus is the most expensive but provides the highest quality. Sonnet offers excellent value for most tasks. Haiku is extremely affordable for high-volume applications. Prompt caching can reduce input costs by up to 90% for repeated context.',
        tableData: {
          headers: ['Model', 'Input / 1M tokens', 'Output / 1M tokens', 'Cache Read / 1M tokens'],
          rows: [
            ['Opus 4.6', '$15.00', '$75.00', '$1.50'],
            ['Sonnet 4.6', '$3.00', '$15.00', '$0.30'],
            ['Haiku 4.5', '$0.80', '$4.00', '$0.08'],
          ],
        },
      },
      {
        title: 'When to Use Each Model',
        content:
          'Choosing the right model depends on your task complexity, latency requirements, and budget. Opus excels at tasks requiring deep reasoning, long-horizon planning, and complex code generation. Sonnet is the workhorse for most professional development tasks. Haiku is perfect for classification, extraction, chatbots, and other high-volume applications.',
        bulletPoints: [
          'Use Opus for: architecture design, complex debugging, research, multi-step analysis',
          'Use Sonnet for: code editing, writing, summarization, daily development tasks',
          'Use Haiku for: chatbots, data extraction, classification, commit messages',
          'Use extended thinking for: math problems, algorithmic challenges, logic puzzles',
          'Use prompt caching when: you send the same system prompt or context repeatedly',
        ],
      },
      {
        title: 'Safety & Alignment',
        content:
          'Claude models are trained with Constitutional AI (CAI), Anthropic\'s alignment approach. The models are designed to be helpful, harmless, and honest. They can refuse harmful requests while remaining maximally helpful for legitimate tasks. Anthropic publishes detailed model cards and safety evaluations for each release.',
        bulletPoints: [
          'Constitutional AI: trained to follow principles rather than just rules',
          'Refuses clearly harmful requests while minimizing false refusals',
          'Transparent about uncertainty -- says "I don\'t know" rather than hallucinating',
          'Model cards published with capability evaluations and safety benchmarks',
          'System prompts allow customization while maintaining safety boundaries',
        ],
      },
    ],
  },
  {
    id: 'gpt-models',
    title: 'GPT Model Family',
    subtitle: 'OpenAI\'s model lineup from GPT-4o to the reasoning-focused o3 and o4-mini.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['openai', 'gpt'],
    content: [
      {
        title: 'Overview',
        content:
          'OpenAI offers two main tracks of models: the GPT series for general-purpose intelligence and the "o" series for advanced reasoning. GPT-4o remains the flagship general model with strong multimodal capabilities. GPT-4.1 was trained specifically for coding and instruction-following. The o-series models (o3, o4-mini) use chain-of-thought reasoning to tackle complex math, science, and coding problems that stump traditional models.',
        bulletPoints: [
          'GPT-4o: Multimodal flagship -- text, image, audio in and out',
          'GPT-4.1: Optimized for coding, long context, and instruction following',
          'o3: Advanced reasoning model for the hardest problems',
          'o4-mini: Fast, affordable reasoning with strong coding ability',
          'All accessible via the OpenAI API and ChatGPT interface',
        ],
      },
      {
        title: 'Model Comparison',
        content:
          'Each model has distinct strengths. GPT-4o is the most versatile, handling text, images, and audio natively. GPT-4.1 excels at code generation and following complex instructions. o3 and o4-mini use internal reasoning chains that improve performance on tasks requiring multi-step logic.',
        tableData: {
          headers: ['Model', 'Context Window', 'Strengths', 'Best For'],
          rows: [
            ['GPT-4o', '128K tokens', 'Multimodal, fast', 'Chat, content, vision tasks'],
            ['GPT-4.1', '1M tokens', 'Coding, instruction following', 'Development, long docs'],
            ['o3', '200K tokens', 'Deep reasoning', 'Math, science, hard coding'],
            ['o4-mini', '200K tokens', 'Fast reasoning', 'Coding, analysis, cost-effective'],
          ],
        },
      },
      {
        title: 'Pricing',
        content:
          'OpenAI\'s pricing varies significantly across models. The reasoning models charge for both visible output tokens and internal reasoning tokens. GPT-4.1 offers strong coding performance at a competitive price point.',
        tableData: {
          headers: ['Model', 'Input / 1M tokens', 'Output / 1M tokens'],
          rows: [
            ['GPT-4o', '$2.50', '$10.00'],
            ['GPT-4.1', '$2.00', '$8.00'],
            ['o3', '$10.00', '$40.00'],
            ['o4-mini', '$1.10', '$4.40'],
          ],
        },
      },
      {
        title: 'Reasoning Models Deep Dive',
        content:
          'The o-series models represent a different approach to AI capability. Instead of generating answers directly, they "think" through problems step by step using internal reasoning tokens. This makes them dramatically better at complex logic, mathematical proofs, and multi-step coding tasks. The trade-off is higher latency and cost, since reasoning tokens are generated before the visible response.',
        bulletPoints: [
          'Internal chain-of-thought reasoning before generating response',
          'Dramatically better at math, logic, and algorithmic problems',
          'Higher latency due to reasoning phase',
          'Reasoning tokens count toward cost but are not visible to users',
          'o4-mini offers a budget-friendly way to access reasoning capabilities',
        ],
      },
    ],
  },
  {
    id: 'gemini-models',
    title: 'Gemini Model Family',
    subtitle: 'Google\'s multimodal models with industry-leading context windows and native tool use.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['google', 'gemini'],
    content: [
      {
        title: 'Overview',
        content:
          'Google\'s Gemini is a natively multimodal model family designed to process text, code, images, audio, and video in a unified architecture. The standout feature is an enormous context window -- up to 1 million tokens in production and 2 million in preview. This means Gemini can process entire codebases, hour-long videos, or thousands of pages of documents in a single prompt.',
        bulletPoints: [
          'Natively multimodal: text, code, images, audio, and video',
          'Up to 1M token context window (2M in preview)',
          'Built-in code execution sandbox',
          'Native Google Search grounding for factual accuracy',
          'Available via Google AI Studio, Vertex AI, and the Gemini app',
        ],
      },
      {
        title: 'Model Variants',
        content:
          'Gemini comes in two main sizes. Gemini 2.5 Pro is the full-power model with reasoning capabilities and massive context. Gemini 2.5 Flash is the faster, more affordable option that retains strong capabilities at lower latency and cost.',
        tableData: {
          headers: ['Model', 'Context', 'Strengths', 'Best For'],
          rows: [
            ['Gemini 2.5 Pro', '1M tokens', 'Reasoning, multimodal, code', 'Complex tasks, long docs, video'],
            ['Gemini 2.5 Flash', '1M tokens', 'Speed, efficiency', 'High-volume, real-time, cost-sensitive'],
          ],
        },
      },
      {
        title: 'Long Context Capabilities',
        content:
          'Gemini\'s long context window is its killer feature. While most models struggle with context beyond 100K tokens, Gemini maintains strong performance across its full 1M token window. This enables use cases that simply aren\'t possible with other models -- analyzing entire codebases, processing full book manuscripts, or understanding hour-long meeting recordings.',
        bulletPoints: [
          'Process entire Git repositories in a single prompt',
          'Analyze hour-long videos with frame-level understanding',
          'Compare and cross-reference thousands of pages of documentation',
          'Maintain conversation history across extremely long sessions',
          'Needle-in-a-haystack retrieval accuracy above 99% across the full context',
        ],
      },
      {
        title: 'Pricing',
        content:
          'Gemini offers competitive pricing, especially for the Flash model. The free tier through Google AI Studio makes it extremely accessible for experimentation.',
        tableData: {
          headers: ['Model', 'Input / 1M tokens', 'Output / 1M tokens', 'Free Tier'],
          rows: [
            ['2.5 Pro', '$1.25 (<=200K) / $2.50 (>200K)', '$10.00', 'Yes (rate limited)'],
            ['2.5 Flash', '$0.15 (<=200K) / $0.30 (>200K)', '$0.60 (non-thinking)', 'Yes (rate limited)'],
          ],
        },
      },
    ],
  },
  {
    id: 'llama-models',
    title: 'Llama 4 Family',
    subtitle: 'Meta\'s open-source models featuring Scout with 10M context and Maverick with 128 experts.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['meta', 'open-source', 'llama'],
    content: [
      {
        title: 'Overview',
        content:
          'Meta\'s Llama 4 represents a major leap in open-source AI. The family introduces two groundbreaking models: Scout and Maverick. Both use a Mixture of Experts (MoE) architecture where only a subset of parameters are active for any given token, making them more efficient than dense models of similar capability. Llama 4 models are released under Meta\'s permissive license, allowing commercial use.',
        bulletPoints: [
          'Scout: 109B total params, 17B active -- 10M token context window',
          'Maverick: 400B total params, 17B active -- 128 expert MoE',
          'Both use Mixture of Experts for efficient inference',
          'Open source with permissive license for commercial use',
          'Natively multilingual with support for 12 languages',
        ],
      },
      {
        title: 'Scout -- The Context Champion',
        content:
          'Llama 4 Scout is built for scenarios requiring massive context. With a 10 million token context window, it can process entire codebases, lengthy legal documents, or vast datasets in a single pass. Despite having 109B total parameters, only 17B are active per token thanks to the MoE architecture, keeping inference costs manageable.',
        bulletPoints: [
          '10M token context window -- largest of any open model',
          '109B total parameters with 16 experts, 1 active at a time',
          'Fits on a single H100 node with appropriate quantization',
          'Strong performance on long-document QA and retrieval tasks',
          'Ideal for RAG, code analysis, and document processing',
        ],
      },
      {
        title: 'Maverick -- The Powerhouse',
        content:
          'Llama 4 Maverick is the high-capability model in the family. With 400B total parameters spread across 128 experts, it delivers strong performance across coding, reasoning, and creative tasks while maintaining efficient inference through its MoE architecture.',
        bulletPoints: [
          '400B total params, 17B active per token',
          '128 expert MoE architecture for specialized processing',
          'Competitive with leading proprietary models on benchmarks',
          'Strong multilingual and multimodal capabilities',
          'Available on major cloud providers and via API',
        ],
      },
      {
        title: 'Running Llama Locally',
        content:
          'One of Llama\'s biggest advantages is the ability to run it on your own hardware. With quantization, even Scout can run on consumer GPUs. This is useful for privacy-sensitive applications, offline use, or avoiding API costs.',
        codeExample: `# Using Ollama
ollama pull llama4-scout
ollama run llama4-scout

# Using llama.cpp with GGUF
./llama-cli -m llama-4-scout-Q4_K_M.gguf \\
  -p "Explain the MoE architecture" \\
  -n 512 --ctx-size 8192

# Using Hugging Face Transformers
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

model = AutoModelForCausalLM.from_pretrained(
    "meta-llama/Llama-4-Scout-109B-Instruct",
    torch_dtype=torch.bfloat16,
    device_map="auto"
)`,
      },
    ],
  },
  {
    id: 'qwen-models',
    title: 'Qwen 3.5 Family',
    subtitle: 'Alibaba\'s Apache 2.0 model lineup spanning from 0.8B to 397B parameters.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['alibaba', 'open-source', 'qwen'],
    content: [
      {
        title: 'Overview',
        content:
          'Qwen 3.5 is Alibaba Cloud\'s latest model family, notable for its Apache 2.0 license (fully open, no restrictions) and extraordinary range of sizes. From the tiny 0.8B model that runs on a phone to the massive 397B MoE model rivaling proprietary offerings, Qwen 3.5 covers every use case. The models offer both dense and Mixture of Experts architectures, with strong performance in coding, math, and multilingual tasks.',
        bulletPoints: [
          'Apache 2.0 license -- fully open for commercial and research use',
          'Size range: 0.8B, 1.5B, 3B, 8B, 14B, 32B, 72B dense + 235B and 397B MoE',
          'Hybrid thinking: models can switch between fast response and deep reasoning',
          'Strong multilingual support with 119 languages',
          'Competitive with Claude Sonnet and GPT-4o on key benchmarks',
        ],
      },
      {
        title: 'Dense vs MoE Models',
        content:
          'Qwen 3.5 offers both dense models (all parameters active for every token) and MoE models (only a subset of experts active). Dense models from 0.8B to 72B are great for deployment on various hardware. The MoE models at 235B and 397B deliver frontier-level performance with efficient inference.',
        tableData: {
          headers: ['Model', 'Architecture', 'Active Params', 'Best For'],
          rows: [
            ['0.8B / 1.5B', 'Dense', 'Full', 'Mobile, edge devices, embedded'],
            ['3B / 8B', 'Dense', 'Full', 'Local inference, consumer GPUs'],
            ['14B / 32B', 'Dense', 'Full', 'Strong general purpose'],
            ['72B', 'Dense', 'Full', 'High-quality, single-node deployment'],
            ['235B MoE', 'MoE (128E/8A)', '22B', 'Cost-effective frontier performance'],
            ['397B MoE', 'MoE (160E/8A)', '30B', 'Maximum capability'],
          ],
        },
      },
      {
        title: 'Hybrid Thinking Mode',
        content:
          'Qwen 3.5 introduces hybrid thinking -- models that can dynamically switch between "fast" mode (direct response) and "thinking" mode (step-by-step reasoning with internal chain-of-thought). This means a single model can handle both quick queries efficiently and complex problems thoroughly, without needing separate model deployments.',
        bulletPoints: [
          'Enable thinking with a simple parameter flag in the API',
          'Model allocates a thinking budget proportional to problem difficulty',
          'Thinking tokens are visible and can be used for debugging',
          'Fast mode for latency-sensitive applications',
          'Deep thinking mode for math, coding, and reasoning tasks',
        ],
      },
      {
        title: 'Running Qwen Locally',
        content:
          'Qwen models are widely available through local inference frameworks. Their Apache 2.0 license means no restrictions on how you deploy them.',
        codeExample: `# Via Ollama
ollama pull qwen3.5:8b
ollama run qwen3.5:8b

# Via llama.cpp (GGUF format)
./llama-cli -m qwen3.5-8b-q4_k_m.gguf \\
  -p "Write a Python function to merge sort"

# Via vLLM for production serving
vllm serve Qwen/Qwen3.5-72B-Instruct \\
  --tensor-parallel-size 4

# Python with Transformers
from transformers import AutoModelForCausalLM, AutoTokenizer
model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen3.5-72B-Instruct",
    torch_dtype="auto",
    device_map="auto"
)`,
      },
    ],
  },
  {
    id: 'deepseek-models',
    title: 'DeepSeek Models',
    subtitle: 'Open-source models excelling at reasoning, coding, and cost efficiency with novel MoE architecture.',
    category: 'models',
    icon: 'AI',
    color: '#6366f1',
    tags: ['deepseek', 'open-source', 'reasoning'],
    content: [
      {
        title: 'Overview',
        content:
          'DeepSeek has emerged as one of the most impressive AI labs, producing open-source models that rival or exceed proprietary offerings at a fraction of the training cost. Their V3 model demonstrated that frontier-level performance doesn\'t require billion-dollar training budgets. DeepSeek R1 introduced a novel reasoning approach that sparked the "reasoning model" wave across the industry.',
        bulletPoints: [
          'DeepSeek V3: 671B MoE model, 37B active -- strong general performance',
          'DeepSeek R1: Reasoning model trained via reinforcement learning',
          'DeepSeek Coder V2: Specialized for code generation and understanding',
          'MIT license on all models -- fully open for any use',
          'Trained at remarkably low cost compared to Western labs',
        ],
      },
      {
        title: 'DeepSeek R1 -- Reasoning Breakthrough',
        content:
          'DeepSeek R1 was a watershed moment for open-source AI. Rather than using supervised fine-tuning on reasoning traces, DeepSeek trained R1 primarily through reinforcement learning, letting the model discover its own reasoning strategies. The result is a model with genuine "thinking" capabilities that rival OpenAI\'s o1 at a fraction of the cost.',
        bulletPoints: [
          'Trained via large-scale reinforcement learning, not just SFT',
          'Discovers emergent reasoning strategies during training',
          'Competitive with o1 on math, coding, and science benchmarks',
          'Distilled versions (1.5B to 70B) retain reasoning capability',
          'Open weights and detailed technical report published',
        ],
      },
      {
        title: 'Architecture -- MoE Efficiency',
        content:
          'DeepSeek pioneered several architectural innovations in their MoE design. Multi-head Latent Attention (MLA) compresses key-value caches to reduce memory usage during long-context inference. DeepSeekMoE uses fine-grained expert segmentation and shared experts for better load balancing.',
        tableData: {
          headers: ['Model', 'Total Params', 'Active Params', 'Architecture', 'License'],
          rows: [
            ['DeepSeek V3', '671B', '37B', 'MoE (256E/8A)', 'MIT'],
            ['DeepSeek R1', '671B', '37B', 'MoE (256E/8A)', 'MIT'],
            ['R1-Distill-Qwen-32B', '32B', '32B', 'Dense (distilled)', 'MIT'],
            ['R1-Distill-Llama-70B', '70B', '70B', 'Dense (distilled)', 'MIT'],
            ['DeepSeek Coder V2', '236B', '21B', 'MoE', 'MIT'],
          ],
        },
      },
      {
        title: 'Using DeepSeek Models',
        content:
          'DeepSeek models are available through the DeepSeek API (extremely affordable), major cloud providers, and local inference frameworks. The distilled R1 versions are particularly popular for local deployment due to their strong reasoning in smaller packages.',
        codeExample: `# DeepSeek API (very affordable)
from openai import OpenAI  # Compatible with OpenAI SDK

client = OpenAI(
    api_key="your-deepseek-key",
    base_url="https://api.deepseek.com"
)

response = client.chat.completions.create(
    model="deepseek-reasoner",  # R1
    messages=[{"role": "user", "content": "Prove that sqrt(2) is irrational"}]
)

# Local with Ollama
# ollama pull deepseek-r1:32b
# ollama run deepseek-r1:32b`,
      },
    ],
  },

  // ===========================================================================
  // FRAMEWORKS
  // ===========================================================================
  {
    id: 'anthropic-sdk',
    title: 'Anthropic Agent SDK',
    subtitle: 'Build custom AI agents with tool use, MCP integration, and multi-agent orchestration.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['sdk', 'anthropic'],
    content: [
      {
        title: 'Overview',
        content:
          'The Anthropic Agent SDK provides Python and TypeScript libraries for building custom AI agents powered by Claude. Going beyond simple chat completions, the SDK supports tool use (function calling), MCP server integration, multi-turn conversations with memory, and multi-agent orchestration. It is designed to be minimal and composable, avoiding the heavy abstractions of larger frameworks.',
        bulletPoints: [
          'Available in Python (claude-agent-sdk) and TypeScript (@anthropic-ai/claude-agent-sdk)',
          'Built-in tool use with automatic schema generation from function signatures',
          'Native MCP client for connecting to any MCP server',
          'Multi-agent orchestration with handoffs and delegation',
          'Streaming support for real-time token-by-token output',
        ],
      },
      {
        title: 'Basic Agent Example',
        content:
          'Creating an agent is straightforward. Define your tools as regular functions with type hints, then create an Agent with a model, instructions, and tools. The SDK handles the conversation loop, tool execution, and response formatting automatically.',
        codeExample: `import anthropic
from claude_agent_sdk import Agent, tool

client = anthropic.Anthropic()

@tool
def get_weather(city: str) -> str:
    """Get the current weather for a city."""
    # In production, call a real weather API
    return f"72F and sunny in {city}"

@tool
def search_restaurants(city: str, cuisine: str) -> list[str]:
    """Search for restaurants in a city by cuisine type."""
    return [f"Best {cuisine} in {city}: Restaurant A, Restaurant B"]

agent = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You are a helpful travel assistant.",
    tools=[get_weather, search_restaurants],
)

# Run the agent
result = agent.run("What's the weather in Tokyo and find me some ramen spots?")
print(result.final_response)`,
      },
      {
        title: 'MCP Integration',
        content:
          'The SDK includes a built-in MCP client that lets your agent connect to any MCP server. This means your agent can access databases, APIs, file systems, and other services through the standardized MCP protocol without writing custom integration code.',
        codeExample: `from claude_agent_sdk import Agent, MCPServerStdio

# Connect to MCP servers
github_server = MCPServerStdio(
    command="npx",
    args=["-y", "@modelcontextprotocol/server-github"],
    env={"GITHUB_TOKEN": "ghp_..."}
)

postgres_server = MCPServerStdio(
    command="npx",
    args=["-y", "@modelcontextprotocol/server-postgres",
          "postgresql://localhost/mydb"]
)

agent = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You help manage our GitHub repos and database.",
    mcp_servers=[github_server, postgres_server],
)

result = agent.run("List open PRs and check if the users table has a new column")`,
      },
      {
        title: 'Multi-Agent Orchestration',
        content:
          'For complex workflows, you can create multiple specialized agents that hand off to each other. Each agent has its own instructions, tools, and capabilities. The orchestrating agent decides when to delegate to a specialist.',
        codeExample: `from claude_agent_sdk import Agent, tool

code_reviewer = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You are an expert code reviewer. Analyze code for bugs and style.",
    tools=[read_file, search_codebase],
)

test_writer = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You write comprehensive unit tests.",
    tools=[read_file, write_file, run_tests],
)

orchestrator = Agent(
    model="claude-sonnet-4-20250514",
    instructions="You coordinate code review and test writing.",
    handoffs=[code_reviewer, test_writer],
)

result = orchestrator.run("Review src/auth.ts and write tests for it")`,
        bulletPoints: [
          'Each agent can have its own model, instructions, and tools',
          'Handoffs transfer conversation context between agents',
          'Orchestrator agent decides when to delegate to specialists',
          'Supports hierarchical and peer-to-peer agent topologies',
        ],
      },
    ],
  },
  {
    id: 'openai-agents-sdk',
    title: 'OpenAI Agents SDK',
    subtitle: 'Build multi-agent systems with handoffs, guardrails, and built-in tracing.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['sdk', 'openai'],
    content: [
      {
        title: 'Overview',
        content:
          'The OpenAI Agents SDK is a lightweight Python framework for building agentic applications. It provides three core primitives: Agents (LLMs with instructions and tools), Handoffs (delegation between agents), and Guardrails (input/output validation). The SDK includes built-in tracing for debugging and monitoring agent behavior, making it production-ready out of the box.',
        bulletPoints: [
          'Three primitives: Agents, Handoffs, and Guardrails',
          'Built-in tracing and observability for debugging',
          'Guardrails for input validation and output safety',
          'Streaming support for real-time responses',
          'Compatible with any OpenAI-compatible API endpoint',
        ],
      },
      {
        title: 'Agent & Tool Definition',
        content:
          'Agents are defined declaratively with a model, instructions, and list of tools. Tools are plain Python functions decorated with @function_tool. The SDK automatically generates the JSON schema from type hints.',
        codeExample: `from agents import Agent, Runner, function_tool

@function_tool
def lookup_order(order_id: str) -> str:
    """Look up an order by its ID and return its status."""
    return f"Order {order_id}: Shipped, arriving tomorrow"

@function_tool
def cancel_order(order_id: str) -> str:
    """Cancel an order by its ID."""
    return f"Order {order_id} has been cancelled"

support_agent = Agent(
    name="Customer Support",
    instructions="You help customers with order inquiries.",
    model="gpt-4.1",
    tools=[lookup_order, cancel_order],
)

# Run the agent
result = Runner.run_sync(
    support_agent,
    "Where is my order ORD-12345?"
)
print(result.final_output)`,
      },
      {
        title: 'Handoffs Between Agents',
        content:
          'Handoffs let you create specialized agents that transfer control to each other. This is powerful for building support systems, multi-step workflows, or any scenario where different expertise is needed at different stages.',
        codeExample: `from agents import Agent, Runner

billing_agent = Agent(
    name="Billing Specialist",
    instructions="You handle billing and payment questions.",
    tools=[get_invoice, process_refund],
)

technical_agent = Agent(
    name="Technical Support",
    instructions="You handle technical issues and bug reports.",
    tools=[search_docs, create_ticket],
)

triage_agent = Agent(
    name="Triage",
    instructions="Route customers to the right specialist.",
    handoffs=[billing_agent, technical_agent],
)

result = Runner.run_sync(triage_agent, "I was charged twice for my subscription")
# Triage agent hands off to billing_agent automatically`,
      },
      {
        title: 'Guardrails & Tracing',
        content:
          'Guardrails are validation layers that check inputs and outputs. Input guardrails run before the agent processes a message, while output guardrails validate the response. The built-in tracing system records every step of agent execution for debugging and monitoring.',
        bulletPoints: [
          'Input guardrails: validate user messages before processing',
          'Output guardrails: check agent responses before returning',
          'Can use a separate LLM call for sophisticated validation',
          'Built-in tracing records tool calls, handoffs, and responses',
          'Traces exportable to OpenTelemetry-compatible backends',
        ],
      },
    ],
  },
  {
    id: 'langchain',
    title: 'LangChain & LangGraph',
    subtitle: 'The most popular framework for building LLM applications with chains, agents, and graphs.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['framework', 'open-source'],
    content: [
      {
        title: 'Overview',
        content:
          'LangChain is the most widely adopted framework for building applications with large language models. It started as a library for "chaining" LLM calls together and has evolved into a comprehensive ecosystem. LangGraph, its companion library, adds stateful graph-based orchestration for building complex agents. Together they form a complete toolkit for everything from simple chatbots to sophisticated multi-agent systems.',
        bulletPoints: [
          'LangChain: Core library with model abstraction, prompts, and tools',
          'LangGraph: Stateful graph-based agent orchestration',
          'LangSmith: Observability, testing, and evaluation platform',
          'Supports every major LLM provider',
          'Huge ecosystem of integrations (700+ packages)',
        ],
      },
      {
        title: 'LangChain Basics',
        content:
          'LangChain provides a unified interface for interacting with different LLM providers, constructing prompts, and chaining operations together. The core abstraction is the "Runnable" -- a composable unit that takes input and produces output.',
        codeExample: `from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# Create a simple chain
model = ChatAnthropic(model="claude-sonnet-4-20250514")
prompt = ChatPromptTemplate.from_template(
    "Explain {topic} in 3 bullet points"
)

chain = prompt | model | StrOutputParser()
result = chain.invoke({"topic": "quantum computing"})

# With tool use
from langchain_core.tools import tool

@tool
def calculate(expression: str) -> float:
    """Evaluate a math expression."""
    return eval(expression)

model_with_tools = model.bind_tools([calculate])`,
      },
      {
        title: 'LangGraph for Agents',
        content:
          'LangGraph enables building agents as state machines represented by graphs. Nodes are functions that process state, and edges define the flow between them. This gives you precise control over agent behavior, including loops, branching, and human-in-the-loop checkpoints.',
        codeExample: `from langgraph.graph import StateGraph, START, END
from typing import TypedDict

class AgentState(TypedDict):
    messages: list
    next_action: str

def call_model(state: AgentState):
    response = model.invoke(state["messages"])
    return {"messages": state["messages"] + [response]}

def should_continue(state: AgentState):
    last = state["messages"][-1]
    if last.tool_calls:
        return "tools"
    return END

# Build the graph
graph = StateGraph(AgentState)
graph.add_node("agent", call_model)
graph.add_node("tools", tool_executor)
graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue)
graph.add_edge("tools", "agent")

app = graph.compile()`,
        bulletPoints: [
          'Nodes: functions that read and update shared state',
          'Edges: define flow (conditional or unconditional)',
          'Checkpointing: save and resume agent state',
          'Human-in-the-loop: pause for user approval at any step',
          'Streaming: token-by-token output from any node',
        ],
      },
      {
        title: 'When to Use LangChain',
        content:
          'LangChain is ideal when you need provider flexibility, complex orchestration, or access to a large integration ecosystem. For simpler projects, the native SDKs (Anthropic SDK, OpenAI SDK) may be more appropriate since they have less abstraction overhead.',
        bulletPoints: [
          'Use LangChain when: you need multi-provider support or complex chains',
          'Use LangGraph when: you need stateful agents with precise control flow',
          'Use native SDKs when: you are committed to one provider and want minimal overhead',
          'LangSmith is valuable for: debugging, testing, and monitoring in production',
          'Consider the trade-off: more abstraction = more flexibility but more complexity',
        ],
      },
    ],
  },
  {
    id: 'crewai',
    title: 'CrewAI',
    subtitle: 'Multi-agent orchestration framework with role-based agents, crews, and automated workflows.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['framework', 'multi-agent'],
    content: [
      {
        title: 'Overview',
        content:
          'CrewAI is a framework for orchestrating multiple AI agents working together as a team. Each agent has a specific role, goal, and backstory that guides its behavior. Agents are organized into "crews" that collaborate on complex tasks through defined processes. CrewAI also offers "flows" for building structured multi-step workflows that combine agent intelligence with deterministic logic.',
        bulletPoints: [
          'Role-based agents with defined personas and expertise',
          'Crews: teams of agents that collaborate on shared tasks',
          'Flows: structured workflows combining AI and traditional logic',
          'Sequential and hierarchical process types',
          'Built-in memory for agents to learn across interactions',
        ],
      },
      {
        title: 'Defining Agents & Tasks',
        content:
          'In CrewAI, agents are defined with a role, goal, and backstory. Tasks describe what needs to be done and are assigned to specific agents. The crew manages the overall process and coordination.',
        codeExample: `from crewai import Agent, Task, Crew, Process

researcher = Agent(
    role="Senior Research Analyst",
    goal="Find comprehensive data on market trends",
    backstory="You are a veteran analyst with 20 years in tech research.",
    tools=[search_tool, web_scraper],
    llm="claude-sonnet-4-20250514",
)

writer = Agent(
    role="Technical Writer",
    goal="Create clear, engaging reports from research data",
    backstory="You are an award-winning technical writer.",
    llm="claude-sonnet-4-20250514",
)

research_task = Task(
    description="Research the current state of AI coding agents in 2026",
    expected_output="A detailed summary with key findings",
    agent=researcher,
)

writing_task = Task(
    description="Write a blog post based on the research findings",
    expected_output="A polished 1000-word blog post",
    agent=writer,
)

crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process=Process.sequential,
)

result = crew.kickoff()`,
      },
      {
        title: 'Flows for Structured Workflows',
        content:
          'Flows are CrewAI\'s way of building reliable, reproducible workflows. They let you combine agent-driven steps with traditional code logic -- for example, fetching data from an API, having an agent analyze it, then storing results in a database.',
        bulletPoints: [
          'Combine AI agent steps with deterministic code steps',
          'Conditional branching based on agent output or data',
          'Built-in state management across flow steps',
          'Error handling and retry logic',
          'Can trigger crews as part of a larger flow',
        ],
      },
      {
        title: 'Process Types',
        content:
          'CrewAI supports different process types that define how agents collaborate within a crew.',
        tableData: {
          headers: ['Process', 'How It Works', 'Best For'],
          rows: [
            ['Sequential', 'Tasks execute one after another, each building on the last', 'Linear workflows with dependencies'],
            ['Hierarchical', 'A manager agent delegates and coordinates other agents', 'Complex projects needing oversight'],
            ['Consensual', 'Agents discuss and agree on approach before executing', 'Decisions requiring multiple perspectives'],
          ],
        },
      },
    ],
  },
  {
    id: 'vercel-ai-sdk',
    title: 'Vercel AI SDK',
    subtitle: 'The TypeScript toolkit for building AI-powered user interfaces with streaming and multi-provider support.',
    category: 'frameworks',
    icon: '{}',
    color: '#f59e0b',
    tags: ['sdk', 'vercel', 'react'],
    content: [
      {
        title: 'Overview',
        content:
          'The Vercel AI SDK is a TypeScript library designed specifically for building AI-powered user interfaces. It provides React hooks and server utilities for streaming AI responses, managing conversations, and rendering tool results -- all with a focus on great UX. Unlike backend-focused frameworks, the AI SDK is built for the full stack, from server-side model calls to client-side streaming UI.',
        bulletPoints: [
          'React hooks for chat, completions, and streaming',
          'Unified provider interface: switch models with one line change',
          'Streaming UI: render AI responses token-by-token',
          'Tool calling with automatic UI generation',
          'Works with Next.js, Nuxt, SvelteKit, and Express',
        ],
      },
      {
        title: 'Core Streaming Example',
        content:
          'The AI SDK makes it trivial to stream AI responses in a React app. The useChat hook handles the conversation state, message history, and streaming automatically.',
        codeExample: `// app/api/chat/route.ts (Next.js API Route)
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { z } from 'zod';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    messages,
    tools: {
      getWeather: {
        description: 'Get weather for a city',
        parameters: z.object({ city: z.string() }),
        execute: async ({ city }) => {
          return { temp: 72, condition: 'sunny' };
        },
      },
    },
  });

  return result.toDataStreamResponse();
}

// app/page.tsx (React Client)
'use client';
import { useChat } from '@ai-sdk/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}`,
      },
      {
        title: 'Multi-Provider Support',
        content:
          'The AI SDK provides a unified interface across providers. Switching from Claude to GPT to Gemini requires changing a single line of code. This makes it easy to test different models or let users choose their preferred provider.',
        tableData: {
          headers: ['Provider', 'Package', 'Models'],
          rows: [
            ['Anthropic', '@ai-sdk/anthropic', 'Claude Opus, Sonnet, Haiku'],
            ['OpenAI', '@ai-sdk/openai', 'GPT-4o, GPT-4.1, o3, o4-mini'],
            ['Google', '@ai-sdk/google', 'Gemini 2.5 Pro, Flash'],
            ['Mistral', '@ai-sdk/mistral', 'Large, Medium, Small'],
            ['Amazon Bedrock', '@ai-sdk/amazon-bedrock', 'All Bedrock models'],
          ],
        },
      },
      {
        title: 'Generative UI',
        content:
          'One of the AI SDK\'s most innovative features is Generative UI -- the ability to stream React components from the server as part of an AI response. Instead of just streaming text, the AI can return interactive UI elements like charts, forms, and cards.',
        bulletPoints: [
          'Stream React Server Components as part of AI responses',
          'Tool results can render as interactive UI components',
          'Mix text and UI elements in a single streaming response',
          'Great for building rich AI dashboards and assistants',
          'Works with React Server Components in Next.js',
        ],
      },
    ],
  },

  // ===========================================================================
  // DESIGN
  // ===========================================================================
  {
    id: 'dark-mode',
    title: 'Dark Mode Design',
    subtitle: 'Best practices for implementing dark mode with system detection, tokens, and accessibility.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['css', 'theme', 'accessibility'],
    content: [
      {
        title: 'Why Dark Mode Matters',
        content:
          'Dark mode has gone from a nice-to-have to an expected feature. Over 80% of users report using dark mode on at least one device. Beyond preference, dark mode reduces eye strain in low-light environments, saves battery on OLED screens, and can improve accessibility for users with certain visual conditions. A well-implemented dark mode also signals design sophistication.',
        bulletPoints: [
          'Reduces eye strain in low-light conditions',
          'Saves 30-60% battery on OLED displays',
          'Improves readability for some visual conditions (light sensitivity)',
          'Expected by users -- over 80% use dark mode on at least one device',
          'Can reduce migraines and visual fatigue for sensitive users',
        ],
      },
      {
        title: 'System Detection',
        content:
          'The first step is respecting the user\'s operating system preference. CSS prefers-color-scheme and React Native\'s Appearance API let you detect this automatically. Best practice is to offer three modes: light, dark, and system (auto).',
        codeExample: `/* CSS: Detect system preference */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #0a0a0a;
    --text-primary: #fafafa;
    --border: #262626;
  }
}

/* React Native: Detect system preference */
import { useColorScheme } from 'react-native';

function App() {
  const colorScheme = useColorScheme(); // 'light' | 'dark'
  const theme = colorScheme === 'dark' ? darkTheme : lightTheme;
  return <ThemeProvider theme={theme}>...</ThemeProvider>;
}`,
      },
      {
        title: 'Token-Based Theming',
        content:
          'The most maintainable approach to dark mode is token-based theming. Define semantic color tokens (like "background-primary" or "text-muted") that map to different values in light and dark modes. This way, components never reference raw colors -- they reference tokens that automatically adapt.',
        bulletPoints: [
          'Define semantic tokens: background, text, border, accent, etc.',
          'Never use raw hex colors in components -- always use tokens',
          'Each token maps to a different value per theme',
          'Add semantic levels: primary, secondary, tertiary for each category',
          'Include special tokens for interactive states: hover, focus, pressed',
        ],
        codeExample: `// Token-based theme system
const tokens = {
  light: {
    bgPrimary: '#ffffff',
    bgSecondary: '#f5f5f5',
    bgTertiary: '#e5e5e5',
    textPrimary: '#0a0a0a',
    textSecondary: '#525252',
    textMuted: '#a3a3a3',
    border: '#e5e5e5',
    accent: '#6366f1',
  },
  dark: {
    bgPrimary: '#0a0a0a',
    bgSecondary: '#171717',
    bgTertiary: '#262626',
    textPrimary: '#fafafa',
    textSecondary: '#d4d4d4',
    textMuted: '#737373',
    border: '#262626',
    accent: '#818cf8',
  },
};`,
      },
      {
        title: 'Common Pitfalls',
        content:
          'Many dark mode implementations fall into common traps that result in poor readability or jarring transitions. Avoid these mistakes for a polished result.',
        bulletPoints: [
          'Do not just invert colors -- pure white on pure black is too harsh',
          'Use slightly off-black backgrounds (#0a0a0a or #121212) and off-white text (#e5e5e5)',
          'Reduce elevation shadows -- they don\'t work on dark backgrounds; use lighter surfaces instead',
          'Test with real content -- dark mode issues often appear only with actual UI layouts',
          'Animate the transition between themes smoothly (300ms ease-in-out)',
          'Do not forget images -- add subtle dark overlays to prevent bright images from blinding users',
        ],
      },
    ],
  },
  {
    id: 'motion-design',
    title: 'Motion & Animation',
    subtitle: 'Spring physics, scroll-driven animations, Framer Motion, and GSAP for modern interfaces.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['animation', 'css', 'react'],
    content: [
      {
        title: 'Why Motion Matters',
        content:
          'Motion is not decoration -- it\'s information. Well-designed animations communicate spatial relationships (where did this element come from?), causality (what caused this change?), and hierarchy (what should I focus on?). Motion guides attention, provides feedback, and creates a sense of direct manipulation that makes interfaces feel responsive and alive.',
        bulletPoints: [
          'Communicates spatial relationships and hierarchy',
          'Provides immediate feedback for user actions',
          'Guides attention to important changes',
          'Creates a sense of quality and polish',
          'Reduces cognitive load by making transitions continuous rather than instant',
        ],
      },
      {
        title: 'Spring Physics',
        content:
          'Modern animation libraries favor spring physics over traditional easing curves. Springs produce more natural-feeling motion because they simulate real-world physics -- objects have mass, tension, and friction. Unlike cubic-bezier easing, springs are interruptible and can be redirected mid-animation without discontinuity.',
        codeExample: `// Framer Motion spring animation
import { motion } from 'framer-motion';

function Card() {
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        type: 'spring',
        stiffness: 300,  // Higher = snappier
        damping: 20,     // Higher = less bounce
        mass: 1,         // Higher = more sluggish
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <h2>Interactive Card</h2>
    </motion.div>
  );
}`,
        bulletPoints: [
          'Stiffness: controls how quickly the spring reaches its target',
          'Damping: controls how quickly oscillation stops (higher = less bounce)',
          'Mass: controls the inertia (higher = slower to start and stop)',
          'Springs are interruptible -- animation can be reversed mid-flight',
          'No fixed duration -- the spring naturally settles based on physics',
        ],
      },
      {
        title: 'Scroll-Driven Animations',
        content:
          'CSS now supports scroll-driven animations natively, without JavaScript. Elements can animate based on scroll position using scroll-timeline and view-timeline. This enables performant, compositor-driven animations for scroll-based effects like parallax, progress indicators, and reveal animations.',
        codeExample: `/* CSS Scroll-Driven Animation */
@keyframes reveal {
  from { opacity: 0; transform: translateY(50px); }
  to   { opacity: 1; transform: translateY(0); }
}

.card {
  animation: reveal linear both;
  animation-timeline: view();
  animation-range: entry 0% entry 100%;
}

/* Scroll progress indicator */
.progress-bar {
  animation: grow linear;
  animation-timeline: scroll();
  transform-origin: left;
}

@keyframes grow {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}`,
        bulletPoints: [
          'No JavaScript needed -- pure CSS with hardware acceleration',
          'scroll() timeline: animates based on scroll position of a container',
          'view() timeline: animates based on element visibility in viewport',
          'animation-range: fine control over when animation starts and ends',
          'Works with existing @keyframes -- no new syntax to learn',
        ],
      },
      {
        title: 'Animation Libraries Comparison',
        content:
          'The right animation library depends on your stack and needs. Here is how the major options compare.',
        tableData: {
          headers: ['Library', 'Best For', 'Size', 'API Style'],
          rows: [
            ['Framer Motion', 'React declarative animations', '~33KB', 'Declarative (JSX props)'],
            ['GSAP', 'Complex timelines, SVG, scroll', '~25KB', 'Imperative (timeline API)'],
            ['React Native Reanimated', 'React Native 60fps animations', '~75KB', 'Worklet-based'],
            ['CSS Animations', 'Simple transitions, scroll-driven', '0KB', 'Declarative (CSS)'],
            ['Motion One', 'Lightweight web animations', '~3KB', 'Imperative (minimal API)'],
          ],
        },
      },
    ],
  },
  {
    id: 'ai-ui-patterns',
    title: 'AI Interface Patterns',
    subtitle: 'UX patterns for streaming text, loading states, prompt inputs, and tool visualization.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['ai', 'ux', 'patterns'],
    content: [
      {
        title: 'The Challenge of AI UX',
        content:
          'AI interfaces have unique UX challenges that traditional software does not face. Responses take seconds to generate rather than milliseconds. Output quality is unpredictable -- the same prompt might give excellent or mediocre results. Users need to understand what the AI is doing (especially during tool use) without being overwhelmed by technical details. These challenges require purpose-built UI patterns.',
        bulletPoints: [
          'Latency: AI responses take 1-30 seconds, requiring thoughtful loading states',
          'Streaming: tokens arrive one by one, needing smooth rendering',
          'Uncertainty: users need confidence signals without false precision',
          'Transparency: tool use and reasoning should be visible but not overwhelming',
          'Prompt design: helping users communicate effectively with AI',
        ],
      },
      {
        title: 'Streaming Text Rendering',
        content:
          'Token-by-token streaming is the most important AI UX pattern. It reduces perceived latency dramatically -- users can start reading immediately instead of waiting for the full response. The key is smooth rendering without visual jank.',
        bulletPoints: [
          'Show a typing indicator during the initial delay before tokens arrive',
          'Render tokens smoothly -- batch DOM updates every 16ms (one frame)',
          'Animate new tokens with a subtle fade-in rather than instant appearance',
          'Auto-scroll to keep the latest content visible, but stop if user scrolls up',
          'Show a "generating..." indicator at the bottom while streaming is active',
          'Render markdown incrementally -- do not wait for the full response to format',
        ],
        codeExample: `// Smooth streaming text component (React)
function StreamingText({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);

  useEffect(() => {
    if (isAutoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [content, isAutoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setIsAutoScroll(isAtBottom);
  };

  return (
    <div ref={containerRef} onScroll={handleScroll}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}`,
      },
      {
        title: 'Tool Use Visualization',
        content:
          'When an AI agent uses tools (searching files, running code, calling APIs), users need visibility into what is happening. The key is progressive disclosure -- show enough to build confidence without overwhelming.',
        bulletPoints: [
          'Show a compact pill/chip for each tool call: "Searching codebase..."',
          'Expand on tap/click to show details: parameters, results, timing',
          'Use distinct icons for different tool types: search, file, API, code',
          'Show a timeline view for multi-step tool chains',
          'Indicate success/failure with color coding (green/red)',
          'Allow users to inspect tool results without cluttering the main response',
        ],
      },
      {
        title: 'Prompt Input Design',
        content:
          'The prompt input is the most important UI element in an AI application. It needs to support complex inputs while remaining approachable. Great prompt inputs guide users toward better prompts.',
        bulletPoints: [
          'Auto-expanding textarea that grows with content (not a fixed single line)',
          'Support file attachments, images, and code blocks in the input',
          'Show suggested prompts or "try asking..." hints for new users',
          'Keyboard shortcuts: Enter to send, Shift+Enter for newline',
          'Character/token count indicator for context-aware usage',
          'Recent prompt history accessible via up-arrow key',
        ],
      },
    ],
  },
  {
    id: 'bento-layouts',
    title: 'Bento Grid Layouts',
    subtitle: 'CSS Grid masonry techniques, responsive breakpoints, and the bento box design trend.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['css', 'layout'],
    content: [
      {
        title: 'What Is Bento Layout?',
        content:
          'Bento layouts (named after Japanese bento boxes) are grid-based designs where cards of varying sizes fit together in a visually pleasing mosaic. Popularized by Apple\'s keynote slides and modern dashboard designs, bento grids break the monotony of uniform card layouts. Each cell can span different numbers of rows and columns, creating visual hierarchy through size rather than just positioning.',
        bulletPoints: [
          'Named after the compartmentalized Japanese lunch boxes',
          'Cards of varying sizes create visual hierarchy and interest',
          'Popularized by Apple keynotes, Notion, and modern dashboards',
          'Uses CSS Grid with span declarations for flexible sizing',
          'Naturally draws attention to featured/important content via larger cells',
        ],
      },
      {
        title: 'CSS Grid Implementation',
        content:
          'Bento layouts are built with CSS Grid. Define a grid with evenly-spaced columns, then use grid-column and grid-row spans to size individual cards. The key is a consistent gap and border-radius for the bento box aesthetic.',
        codeExample: `/* Bento Grid Container */
.bento-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 180px;
  gap: 16px;
  padding: 16px;
}

/* Card sizes */
.bento-card { border-radius: 16px; padding: 24px; }
.bento-card--wide { grid-column: span 2; }
.bento-card--tall { grid-row: span 2; }
.bento-card--large { grid-column: span 2; grid-row: span 2; }
.bento-card--full { grid-column: span 4; }

/* Responsive breakpoints */
@media (max-width: 1024px) {
  .bento-grid { grid-template-columns: repeat(3, 1fr); }
  .bento-card--full { grid-column: span 3; }
}

@media (max-width: 768px) {
  .bento-grid { grid-template-columns: repeat(2, 1fr); }
  .bento-card--wide { grid-column: span 2; }
  .bento-card--large { grid-column: span 2; }
  .bento-card--full { grid-column: span 2; }
}

@media (max-width: 480px) {
  .bento-grid { grid-template-columns: 1fr; }
  .bento-card--wide,
  .bento-card--large,
  .bento-card--full { grid-column: span 1; }
}`,
      },
      {
        title: 'Design Guidelines',
        content:
          'A great bento layout follows specific design principles that separate it from a random grid of cards.',
        bulletPoints: [
          'Consistent gap size (12-20px) -- this creates the "compartment" feeling',
          'Generous border-radius (12-20px) for the modern rounded aesthetic',
          'Limit card sizes to 4-5 variants for visual consistency',
          'Use the largest card for the most important content',
          'Alternate card colors or subtle gradients for visual distinction',
          'Ensure the layout remains scannable -- large cards should not dominate on mobile',
        ],
      },
      {
        title: 'CSS Masonry (Upcoming)',
        content:
          'CSS Masonry is an upcoming CSS Grid feature that automatically packs items into columns without explicit row spans, similar to Pinterest-style layouts. This will make bento-style layouts even easier to build without JavaScript.',
        codeExample: `/* CSS Masonry (in development - available behind flags) */
.masonry-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: masonry;  /* The magic property */
  gap: 16px;
}

/* Items naturally pack into available space */
.masonry-item {
  border-radius: 16px;
  /* Height is determined by content -- no row spans needed */
}`,
        bulletPoints: [
          'grid-template-rows: masonry auto-packs items vertically',
          'No JavaScript needed for waterfall layouts',
          'Currently behind flags in Firefox and Safari',
          'Will simplify bento layouts dramatically once widely supported',
        ],
      },
    ],
  },
  {
    id: 'design-systems',
    title: 'Modern Design Systems',
    subtitle: 'Design tokens, shadcn/ui, headless UI, and compound component patterns for scalable UI.',
    category: 'design',
    icon: '[]',
    color: '#ec4899',
    tags: ['system', 'tokens', 'components'],
    content: [
      {
        title: 'What Is a Design System?',
        content:
          'A design system is the single source of truth for a product\'s UI. It includes design tokens (colors, spacing, typography), reusable components, usage guidelines, and accessibility standards. Modern design systems have shifted from monolithic component libraries to composable, headless approaches that separate behavior from styling.',
        bulletPoints: [
          'Design tokens: the atomic values (colors, spacing, radius, typography)',
          'Components: reusable UI building blocks with consistent behavior',
          'Patterns: solutions for common UX problems (forms, navigation, modals)',
          'Guidelines: documentation on when and how to use each piece',
          'Accessibility: built-in a11y compliance (ARIA, keyboard navigation, focus)',
        ],
      },
      {
        title: 'Design Tokens',
        content:
          'Design tokens are the foundation of any design system. They are named values that represent design decisions -- colors, spacing, font sizes, border radii, shadows, and more. By using tokens instead of raw values, you ensure consistency and enable theming.',
        codeExample: `// Design tokens as a typed system
const tokens = {
  colors: {
    gray: {
      50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5',
      300: '#d4d4d4', 400: '#a3a3a3', 500: '#737373',
      600: '#525252', 700: '#404040', 800: '#262626',
      900: '#171717', 950: '#0a0a0a',
    },
    primary: {
      50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe',
      500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
    },
  },
  spacing: {
    xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48,
  },
  radius: {
    sm: 6, md: 8, lg: 12, xl: 16, full: 9999,
  },
  typography: {
    heading: { fontFamily: 'Inter', fontWeight: 700 },
    body: { fontFamily: 'Inter', fontWeight: 400 },
    mono: { fontFamily: 'JetBrains Mono', fontWeight: 400 },
  },
} as const;`,
        bulletPoints: [
          'Use semantic names: "primary-500" not "#6366f1"',
          'Layer tokens: primitive (gray-500) -> semantic (text-muted) -> component (button-text)',
          'Keep spacing on a consistent scale (4px base unit is common)',
          'Define tokens in a platform-agnostic format, then generate for CSS, JS, iOS, Android',
        ],
      },
      {
        title: 'shadcn/ui Approach',
        content:
          'shadcn/ui popularized a radically different approach: instead of installing a component library from npm, you copy component source code directly into your project. Components are built on Radix UI primitives (for accessibility) and styled with Tailwind CSS (for flexibility). You own the code completely and can modify anything.',
        bulletPoints: [
          'Copy-paste, not install -- components live in your codebase',
          'Built on Radix UI for accessible, headless primitives',
          'Styled with Tailwind CSS -- fully customizable',
          'CLI tool (npx shadcn add button) to scaffold components',
          'Growing ecosystem: charts, forms, tables, and more',
          'Theming via CSS variables -- easy dark mode and brand customization',
        ],
      },
      {
        title: 'Headless UI Libraries',
        content:
          'Headless UI libraries provide behavior and accessibility without any styling. This gives you complete control over appearance while getting complex interactions (dropdowns, modals, tabs, etc.) handled correctly.',
        tableData: {
          headers: ['Library', 'Framework', 'Approach', 'Styling'],
          rows: [
            ['Radix UI', 'React', 'Headless primitives', 'Bring your own'],
            ['Headless UI', 'React / Vue', 'Headless components', 'Bring your own'],
            ['Ark UI', 'React / Vue / Solid', 'State machines', 'Bring your own'],
            ['shadcn/ui', 'React', 'Radix + Tailwind', 'Tailwind (customizable)'],
            ['Chakra UI', 'React', 'Styled components', 'Built-in theme'],
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // OPEN SOURCE
  // ===========================================================================
  {
    id: 'local-models',
    title: 'Running Models Locally',
    subtitle: 'A guide to Ollama, llama.cpp, LM Studio, and running AI models on your own hardware.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['local', 'inference', 'ollama'],
    content: [
      {
        title: 'Why Run Models Locally?',
        content:
          'Running AI models on your own hardware gives you complete control over your data, eliminates API costs, works offline, and enables customization not possible with hosted services. With recent advances in model quantization and efficient inference engines, running capable models locally is more accessible than ever -- even consumer GPUs can run high-quality 7B-70B models.',
        bulletPoints: [
          'Privacy: your data never leaves your machine',
          'Cost: no per-token API charges after initial hardware investment',
          'Offline: works without internet, great for air-gapped environments',
          'Customization: fine-tune, quantize, and modify models freely',
          'Latency: no network round-trip -- responses can be extremely fast',
        ],
      },
      {
        title: 'Ollama -- The Easy Way',
        content:
          'Ollama is the most user-friendly way to run models locally. It provides a simple CLI with a Docker-like model management system. Download a model, run it -- that is it. Ollama handles quantization, GPU acceleration, and serving an OpenAI-compatible API automatically.',
        codeExample: `# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull and run a model
ollama pull llama3.1:8b
ollama run llama3.1:8b

# List installed models
ollama list

# Run with specific options
ollama run qwen3.5:14b --ctx-size 32768

# Serve an OpenAI-compatible API (auto-starts)
# POST http://localhost:11434/v1/chat/completions
curl http://localhost:11434/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "llama3.1:8b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`,
        bulletPoints: [
          'One command to download and run any supported model',
          'Automatic GPU detection and acceleration (CUDA, Metal, ROCm)',
          'OpenAI-compatible REST API at localhost:11434',
          'Model library with hundreds of pre-quantized models',
          'Supports custom Modelfiles for configuration',
        ],
      },
      {
        title: 'llama.cpp -- Maximum Performance',
        content:
          'llama.cpp is a C/C++ inference engine that runs GGUF-format models with maximum efficiency. It is the foundation that many other tools (including Ollama) build upon. For users who want the highest performance and most control, llama.cpp provides direct access to quantization, batch processing, and GPU offloading.',
        bulletPoints: [
          'Pure C/C++ with no dependencies -- runs on anything',
          'GGUF format: single-file models with metadata',
          'Quantization from Q2 to Q8 for different quality/speed trade-offs',
          'GPU offloading: split model layers between CPU and GPU',
          'Server mode with OpenAI-compatible API',
          'Speculative decoding for faster inference',
        ],
      },
      {
        title: 'Hardware Requirements',
        content:
          'The hardware you need depends on model size and quantization level. As a rule of thumb, you need roughly 0.5-1GB of RAM per billion parameters at Q4 quantization.',
        tableData: {
          headers: ['Model Size', 'Q4 RAM', 'Recommended GPU', 'Speed (tokens/sec)'],
          rows: [
            ['3B', '~2 GB', 'Any GPU / CPU only', '40-80 t/s'],
            ['7-8B', '~4-5 GB', '8GB VRAM (RTX 3060)', '30-50 t/s'],
            ['14B', '~8 GB', '12GB VRAM (RTX 3060 Ti)', '20-35 t/s'],
            ['32B', '~18 GB', '24GB VRAM (RTX 4090)', '15-25 t/s'],
            ['70B', '~40 GB', '48GB+ VRAM or dual GPU', '8-15 t/s'],
          ],
        },
      },
      {
        title: 'LM Studio',
        content:
          'LM Studio provides a polished desktop application for running models locally. It includes a built-in model browser, chat interface, and OpenAI-compatible API server. It is ideal for users who prefer a graphical interface over command-line tools.',
        bulletPoints: [
          'Desktop GUI for macOS, Windows, and Linux',
          'Built-in model search and download from Hugging Face',
          'Visual chat interface with conversation management',
          'OpenAI-compatible API server for integration with other tools',
          'Supports GGUF, GGML, and other quantization formats',
        ],
      },
    ],
  },
  {
    id: 'fine-tuning',
    title: 'Fine-Tuning Guide',
    subtitle: 'How to customize AI models with Unsloth, QLoRA, TRL, and proper data preparation.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['training', 'fine-tune'],
    content: [
      {
        title: 'What Is Fine-Tuning?',
        content:
          'Fine-tuning is the process of further training a pre-trained model on your own data to specialize it for a specific task or domain. Instead of training from scratch (which costs millions), you start with a capable base model and teach it your particular patterns, terminology, or preferences. Modern techniques like LoRA and QLoRA make fine-tuning possible on a single consumer GPU.',
        bulletPoints: [
          'Start with a pre-trained model and adapt it to your needs',
          'Much cheaper than training from scratch -- hours instead of months',
          'Teach domain-specific knowledge, style, or format',
          'LoRA/QLoRA: train only a tiny fraction of parameters (0.1-1%)',
          'Can be done on a single GPU with 16-24GB VRAM',
        ],
      },
      {
        title: 'Data Preparation',
        content:
          'The quality of your fine-tuning data is the single most important factor. Garbage in, garbage out. Your dataset should be diverse, high-quality, and formatted in the conversation format the model expects. Most models use the ChatML or similar instruction-following format.',
        codeExample: `# Training data format (JSONL - one example per line)
{"messages": [
  {"role": "system", "content": "You are a legal assistant specializing in contract law."},
  {"role": "user", "content": "What is a force majeure clause?"},
  {"role": "assistant", "content": "A force majeure clause is a contractual provision..."}
]}

# Data preparation script
import json
from datasets import Dataset

def prepare_dataset(raw_data):
    """Convert raw Q&A pairs to chat format."""
    formatted = []
    for item in raw_data:
        formatted.append({
            "messages": [
                {"role": "system", "content": "You are a helpful domain expert."},
                {"role": "user", "content": item["question"]},
                {"role": "assistant", "content": item["answer"]},
            ]
        })
    return Dataset.from_list(formatted)`,
        bulletPoints: [
          'Aim for 500-10,000 high-quality examples (more is not always better)',
          'Diverse examples covering the range of expected inputs',
          'Consistent formatting -- use the model\'s expected chat template',
          'Clean data: remove duplicates, fix errors, validate formatting',
          'Include edge cases and negative examples',
        ],
      },
      {
        title: 'Fine-Tuning with Unsloth',
        content:
          'Unsloth is the fastest and most memory-efficient fine-tuning library, achieving 2-5x speedup over standard methods. It supports QLoRA (quantized LoRA) which allows fine-tuning large models on consumer GPUs by keeping the base model in 4-bit precision while training small adapter layers in full precision.',
        codeExample: `from unsloth import FastLanguageModel
from trl import SFTTrainer
from transformers import TrainingArguments

# Load model with 4-bit quantization
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen2.5-7B-Instruct",
    max_seq_length=2048,
    load_in_4bit=True,
)

# Add LoRA adapters (only these tiny layers get trained)
model = FastLanguageModel.get_peft_model(
    model,
    r=16,              # LoRA rank (higher = more capacity)
    lora_alpha=16,     # Scaling factor
    lora_dropout=0,    # Dropout for regularization
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
)

# Train
trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=TrainingArguments(
        output_dir="./output",
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        num_train_epochs=3,
        learning_rate=2e-4,
        fp16=True,
    ),
)

trainer.train()

# Save and export
model.save_pretrained_merged("./merged_model", tokenizer)
# Or export to GGUF for llama.cpp/Ollama
model.save_pretrained_gguf("./gguf_model", tokenizer,
    quantization_method="q4_k_m")`,
      },
      {
        title: 'When to Fine-Tune vs. Prompt',
        content:
          'Fine-tuning is not always the answer. For many tasks, well-crafted prompts, few-shot examples, or RAG (retrieval-augmented generation) are more cost-effective. Fine-tuning is best when you need consistent style, domain-specific knowledge baked into the model, or faster inference (no long system prompts needed).',
        tableData: {
          headers: ['Approach', 'Best When', 'Effort', 'Cost'],
          rows: [
            ['Prompt Engineering', 'Task is well-defined, few patterns', 'Low', '$'],
            ['Few-Shot Examples', 'Need consistent format/style', 'Low', '$'],
            ['RAG', 'Need up-to-date or large knowledge base', 'Medium', '$$'],
            ['Fine-Tuning', 'Need specialized behavior or domain expertise', 'High', '$$$'],
            ['Pre-Training', 'Need new language or entirely new domain', 'Very High', '$$$$'],
          ],
        },
      },
    ],
  },
  {
    id: 'vector-databases',
    title: 'Vector Databases & RAG',
    subtitle: 'Embeddings, vector search, and retrieval-augmented generation with Chroma, Pinecone, and Qdrant.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['rag', 'vector', 'database'],
    content: [
      {
        title: 'What Is RAG?',
        content:
          'Retrieval-Augmented Generation (RAG) is a technique that enhances AI responses by retrieving relevant information from a knowledge base before generating a response. Instead of relying solely on the model\'s training data (which is static and potentially outdated), RAG systems search a vector database for relevant documents and include them in the prompt. This gives the model access to current, domain-specific information.',
        bulletPoints: [
          'Combines retrieval (search) with generation (LLM response)',
          'Enables AI to access current, private, or specialized data',
          'Reduces hallucination by grounding responses in real documents',
          'More cost-effective than fine-tuning for knowledge-heavy applications',
          'Knowledge base can be updated without retraining the model',
        ],
      },
      {
        title: 'How Embeddings Work',
        content:
          'Embeddings are the foundation of RAG. An embedding model converts text into dense numerical vectors that capture semantic meaning. Similar texts produce similar vectors, enabling semantic search -- finding relevant content based on meaning rather than keyword matching.',
        codeExample: `# Generate embeddings with OpenAI
from openai import OpenAI
client = OpenAI()

response = client.embeddings.create(
    model="text-embedding-3-small",
    input="How do I implement authentication in Next.js?"
)
vector = response.data[0].embedding  # [0.023, -0.041, 0.018, ...]
# 1536-dimensional vector capturing the semantic meaning

# With Sentence Transformers (local, free)
from sentence_transformers import SentenceTransformer
model = SentenceTransformer('all-MiniLM-L6-v2')
vectors = model.encode(["auth in Next.js", "login system React"])
# Cosine similarity reveals semantic relatedness`,
        bulletPoints: [
          'Each text chunk becomes a high-dimensional vector (768-3072 dimensions)',
          'Similar meanings produce similar vectors (close in vector space)',
          'Cosine similarity or dot product measures relatedness',
          'Different models produce different quality embeddings',
          'OpenAI, Cohere, and open-source models all offer embedding APIs',
        ],
      },
      {
        title: 'Vector Database Comparison',
        content:
          'Vector databases are specialized for storing, indexing, and querying embedding vectors at scale. They use approximate nearest neighbor (ANN) algorithms for fast similarity search.',
        tableData: {
          headers: ['Database', 'Type', 'Best For', 'Pricing'],
          rows: [
            ['Chroma', 'Embedded / Server', 'Prototyping, local dev, small-medium scale', 'Free (open source)'],
            ['Pinecone', 'Managed cloud', 'Production, serverless, zero-ops', 'Free tier + pay-per-use'],
            ['Qdrant', 'Self-hosted / Cloud', 'High performance, filtering, hybrid search', 'Free (open source) + cloud'],
            ['Weaviate', 'Self-hosted / Cloud', 'Multi-modal, GraphQL API', 'Free (open source) + cloud'],
            ['pgvector', 'PostgreSQL extension', 'When you already use Postgres', 'Free (extension)'],
          ],
        },
      },
      {
        title: 'Building a RAG Pipeline',
        content:
          'A typical RAG pipeline has two phases: indexing (preparing your knowledge base) and querying (retrieving relevant context for each user question).',
        codeExample: `# Simple RAG pipeline with Chroma
import chromadb
from openai import OpenAI

client = OpenAI()
chroma = chromadb.PersistentClient(path="./chroma_db")
collection = chroma.get_or_create_collection("docs")

# INDEXING PHASE: Add documents
documents = [
    "Next.js uses file-based routing in the app/ directory...",
    "Authentication can be implemented with NextAuth.js...",
    "Server Components run on the server and reduce bundle size...",
]

collection.add(
    documents=documents,
    ids=[f"doc_{i}" for i in range(len(documents))],
)

# QUERY PHASE: Retrieve and generate
def ask(question: str) -> str:
    # 1. Retrieve relevant documents
    results = collection.query(query_texts=[question], n_results=3)
    context = "\\n".join(results["documents"][0])

    # 2. Generate answer with context
    response = client.chat.completions.create(
        model="gpt-4.1",
        messages=[
            {"role": "system", "content": f"Answer based on this context:\\n{context}"},
            {"role": "user", "content": question},
        ],
    )
    return response.choices[0].message.content

answer = ask("How do I add auth to my Next.js app?")`,
        bulletPoints: [
          'Chunk documents into 200-500 token segments with overlap',
          'Generate embeddings for each chunk and store in vector DB',
          'At query time, embed the question and find similar chunks',
          'Include top-k results as context in the LLM prompt',
          'Add metadata filtering for more precise retrieval',
        ],
      },
    ],
  },
  {
    id: 'hugging-face',
    title: 'Hugging Face Ecosystem',
    subtitle: 'The hub for open-source AI: models, datasets, Spaces, and the Inference API.',
    category: 'open-source',
    icon: 'OS',
    color: '#22d3ee',
    tags: ['platform', 'hub'],
    content: [
      {
        title: 'What Is Hugging Face?',
        content:
          'Hugging Face is the GitHub of machine learning. It is a platform where researchers and developers share models, datasets, and applications (Spaces). With over 500,000 models and 100,000 datasets, it is the central hub for the open-source AI community. Beyond hosting, Hugging Face provides the Transformers library (the most popular ML library), training tools, and inference infrastructure.',
        bulletPoints: [
          'Model Hub: 500K+ pre-trained models across all domains',
          'Datasets: 100K+ datasets for training and evaluation',
          'Spaces: hosted ML demos and applications (Gradio/Streamlit)',
          'Transformers library: unified API for all major model architectures',
          'Inference API: run any model via API without hosting infrastructure',
        ],
      },
      {
        title: 'The Model Hub',
        content:
          'The Model Hub is where the AI community shares pre-trained models. Every major open-source model is available here -- Llama, Qwen, Mistral, DeepSeek, Phi, and thousands more. Each model page includes documentation, benchmarks, usage examples, and community discussions.',
        bulletPoints: [
          'Search and filter by task, framework, language, and license',
          'Model cards document capabilities, limitations, and training details',
          'Versioning and automatic downloads via the transformers library',
          'Community contributions: quantized versions, fine-tuned variants',
          'Gated models: some require accepting license terms before download',
        ],
        codeExample: `# Using models from the Hub
from transformers import pipeline

# Text generation
generator = pipeline("text-generation", model="Qwen/Qwen3.5-8B-Instruct")
result = generator("Explain quantum computing:", max_length=200)

# Sentiment analysis
classifier = pipeline("sentiment-analysis")
result = classifier("I love this product!")
# [{'label': 'POSITIVE', 'score': 0.9998}]

# Using the Hub API
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(
    filter="text-generation",
    sort="downloads",
    direction=-1,
    limit=10,
)`,
      },
      {
        title: 'Spaces -- Hosted ML Apps',
        content:
          'Spaces let you deploy machine learning applications for free. Build interactive demos with Gradio or Streamlit, and Hugging Face handles the hosting, scaling, and GPU allocation. Spaces are great for showcasing models, building prototypes, and creating tools for non-technical users.',
        bulletPoints: [
          'Free hosting for Gradio and Streamlit applications',
          'Optional GPU acceleration (T4, A10G, A100)',
          'Docker support for custom applications',
          'Embed Spaces in other websites via iframe',
          'Community can duplicate and fork Spaces',
        ],
      },
      {
        title: 'Inference API & Endpoints',
        content:
          'Hugging Face provides two ways to run models without managing infrastructure: the free Inference API for prototyping and Inference Endpoints for production deployment.',
        tableData: {
          headers: ['Service', 'Use Case', 'Pricing', 'Features'],
          rows: [
            ['Inference API (Free)', 'Prototyping, testing', 'Free (rate limited)', 'Thousands of models, instant access'],
            ['Inference API (Pro)', 'Development', '$9/month', 'Higher limits, faster responses'],
            ['Inference Endpoints', 'Production', 'Per-hour GPU pricing', 'Dedicated infra, autoscaling, private'],
            ['Spaces', 'Demos, apps', 'Free (basic) / GPU upgrades', 'Full app hosting with UI'],
          ],
        },
      },
    ],
  },

  // ===========================================================================
  // MCP
  // ===========================================================================
  {
    id: 'mcp-overview',
    title: 'What is MCP?',
    subtitle: 'The Model Context Protocol: an open standard connecting AI models to data, tools, and services.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['protocol', 'architecture'],
    content: [
      {
        title: 'MCP Explained',
        content:
          'The Model Context Protocol (MCP) is an open standard created by Anthropic that provides a universal way for AI models to interact with external tools, data sources, and services. Think of it as a "USB-C for AI" -- a single protocol that connects any AI client to any tool or data source. Before MCP, every AI application had to build custom integrations for each service. MCP standardizes this into a client-server architecture with a well-defined protocol.',
        bulletPoints: [
          'Open standard -- anyone can implement clients and servers',
          'Replaces custom one-off integrations with a universal protocol',
          'Clients: AI applications (Claude Code, Cursor, IDEs)',
          'Servers: tool providers (GitHub, databases, APIs, file systems)',
          'Supports tools (functions), resources (data), and prompts (templates)',
        ],
      },
      {
        title: 'Architecture',
        content:
          'MCP follows a client-server architecture. The Host is the AI application (like Claude Code). It contains an MCP Client that connects to one or more MCP Servers. Each server exposes tools, resources, and prompts through a standardized JSON-RPC protocol. Servers can be local processes (connected via stdio) or remote services (connected via HTTP/SSE).',
        bulletPoints: [
          'Host: the AI application that initiates connections',
          'Client: protocol handler inside the host, manages server connections',
          'Server: provides tools, resources, and prompts to the client',
          'Transport: stdio (local processes) or HTTP+SSE (remote services)',
          'JSON-RPC 2.0: the wire protocol for all communication',
        ],
        codeExample: `// MCP Architecture Diagram
//
// +-----------------------------------+
// |         Host (Claude Code)        |
// |  +-----------+  +-----------+     |
// |  | Client  1 |  | Client  2 |     |
// |  +-----+-----+  +-----+-----+    |
// +--------|--------------|-----------+
//          |              |
//    +-----+-----+  +----+------+
//    | MCP Server |  | MCP Server |
//    |  (GitHub)  |  | (Database) |
//    +-----------+  +-----------+`,
      },
      {
        title: 'Core Primitives',
        content:
          'MCP defines three types of capabilities that servers can expose to clients.',
        tableData: {
          headers: ['Primitive', 'Description', 'Example', 'Initiated By'],
          rows: [
            ['Tools', 'Functions the AI can call', 'create_issue, query_db, send_message', 'Model (via client)'],
            ['Resources', 'Data the AI can read', 'File contents, database records, API responses', 'Client (application)'],
            ['Prompts', 'Reusable prompt templates', 'Code review template, SQL query builder', 'User (via client)'],
          ],
        },
        bulletPoints: [
          'Tools: model-controlled actions -- the AI decides when to use them',
          'Resources: application-controlled data -- the host decides what to include',
          'Prompts: user-controlled templates -- the user selects and fills in parameters',
        ],
      },
      {
        title: 'Why MCP Matters',
        content:
          'MCP is transforming how AI applications integrate with the world. Instead of each AI tool building its own GitHub integration, database connector, or Slack bridge, MCP creates a shared ecosystem where a single server implementation works with every MCP-compatible client.',
        bulletPoints: [
          'Write one MCP server, use it in Claude Code, Cursor, and any MCP client',
          'Growing ecosystem: 100+ community MCP servers available',
          'Standardized security: authentication, authorization, and scoping',
          'Reduces integration maintenance burden for both sides',
          'Enables a marketplace of AI capabilities',
        ],
      },
      {
        title: 'Transport Types',
        content:
          'MCP supports two main transport mechanisms for communication between clients and servers. The choice depends on whether the server runs locally or remotely.',
        tableData: {
          headers: ['Transport', 'How It Works', 'Best For', 'Security'],
          rows: [
            ['stdio', 'Client spawns server as child process, communicates via stdin/stdout', 'Local tools, CLI integrations', 'Process isolation'],
            ['HTTP + SSE', 'Server runs on a URL, client connects via HTTP POST + SSE stream', 'Remote services, shared servers', 'HTTPS + auth tokens'],
          ],
        },
      },
    ],
  },
  {
    id: 'mcp-servers',
    title: 'Popular MCP Servers',
    subtitle: 'The most useful MCP servers: GitHub, Slack, databases, Playwright, and more.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['servers', 'integrations'],
    content: [
      {
        title: 'The MCP Server Ecosystem',
        content:
          'The MCP ecosystem has grown rapidly with hundreds of community-built servers covering development tools, databases, communication platforms, and more. These servers can be used with any MCP-compatible client (Claude Code, Cursor, etc.) to give AI agents access to your real tools and data.',
        bulletPoints: [
          'Most servers are npm packages -- install and configure in minutes',
          'Official servers maintained by Anthropic and major platforms',
          'Community servers cover nearly every popular service',
          'Configuration via JSON -- add to your MCP settings file',
          'Servers run locally or remotely depending on architecture',
        ],
      },
      {
        title: 'Essential Servers',
        content:
          'These are the most widely used MCP servers that cover common development workflows.',
        tableData: {
          headers: ['Server', 'Package', 'Capabilities'],
          rows: [
            ['GitHub', '@modelcontextprotocol/server-github', 'Issues, PRs, repos, code search, file contents'],
            ['Postgres', '@modelcontextprotocol/server-postgres', 'Query, schema inspection, data analysis'],
            ['Filesystem', '@modelcontextprotocol/server-filesystem', 'Read, write, search files with sandboxing'],
            ['Slack', '@modelcontextprotocol/server-slack', 'Send messages, search, read channels'],
            ['Playwright', '@playwright/mcp', 'Browser automation, screenshots, testing'],
            ['Memory', '@modelcontextprotocol/server-memory', 'Persistent knowledge graph across sessions'],
            ['Fetch', '@modelcontextprotocol/server-fetch', 'HTTP requests, web scraping, API calls'],
          ],
        },
      },
      {
        title: 'Configuration',
        content:
          'MCP servers are configured in a JSON settings file. Each server entry specifies the command to run, arguments, and optional environment variables. Here is how to set up common servers.',
        codeExample: `// ~/.claude/settings.json (for Claude Code)
// Or .mcp.json in project root
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    },
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://user:pass@localhost:5432/mydb"
      ]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    },
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/path/to/allowed/directory"
      ]
    }
  }
}`,
      },
      {
        title: 'Specialized Servers',
        content:
          'Beyond the essentials, the ecosystem includes specialized servers for specific domains and use cases.',
        tableData: {
          headers: ['Server', 'Domain', 'What It Does'],
          rows: [
            ['Sentry', 'Monitoring', 'Query errors, manage issues, analyze crash data'],
            ['Linear', 'Project Mgmt', 'Create/update issues, manage sprints'],
            ['Figma', 'Design', 'Read designs, extract styles, component info'],
            ['Stripe', 'Payments', 'Manage customers, subscriptions, invoices'],
            ['Supabase', 'Database', 'Query, manage tables, auth, storage'],
            ['Notion', 'Docs', 'Read/write pages, databases, blocks'],
          ],
        },
      },
      {
        title: 'Finding & Evaluating Servers',
        content:
          'The MCP ecosystem is growing rapidly. Here is where to find servers for your needs and how to evaluate them.',
        bulletPoints: [
          'Official list: github.com/modelcontextprotocol/servers',
          'MCP Hub: mcp.so -- searchable directory of community servers',
          'npm: search for "@modelcontextprotocol/server-" prefix',
          'GitHub: search for "mcp-server" repositories',
          'Check server README for required permissions and environment variables',
          'Prefer servers with active maintenance and TypeScript/Python implementations',
        ],
      },
    ],
  },
  {
    id: 'building-mcp',
    title: 'Building MCP Servers',
    subtitle: 'How to build custom MCP servers with Python FastMCP, TypeScript SDK, tools, and resources.',
    category: 'mcp',
    icon: '<>',
    color: '#a855f7',
    tags: ['development', 'tutorial'],
    content: [
      {
        title: 'Why Build an MCP Server?',
        content:
          'Building a custom MCP server lets you connect AI agents to your own tools, APIs, and data sources. If you have an internal API, a proprietary database, or a custom workflow, an MCP server makes it accessible to any AI client. The development experience is straightforward -- the Python and TypeScript SDKs handle the protocol details, so you just define your tools and resources.',
        bulletPoints: [
          'Connect AI agents to your internal tools and APIs',
          'One server works with all MCP-compatible clients',
          'SDKs handle protocol, transport, and message formatting',
          'You just define tools (functions) and resources (data)',
          'Can be deployed locally (stdio) or remotely (HTTP/SSE)',
        ],
      },
      {
        title: 'Python with FastMCP',
        content:
          'FastMCP is the recommended Python SDK for building MCP servers. It provides a Flask-like decorator API that makes server creation incredibly simple. Define functions with type hints, add a @tool or @resource decorator, and you have a working MCP server.',
        codeExample: `# pip install fastmcp
from fastmcp import FastMCP

mcp = FastMCP("My Custom Server")

@mcp.tool()
def search_docs(query: str, limit: int = 5) -> list[dict]:
    """Search our documentation for relevant articles.

    Args:
        query: The search query string
        limit: Maximum number of results to return
    """
    # Your actual search logic here
    results = my_search_engine.search(query, limit=limit)
    return [{"title": r.title, "url": r.url, "snippet": r.snippet}
            for r in results]

@mcp.tool()
def create_ticket(
    title: str, description: str, priority: str = "medium"
) -> dict:
    """Create a support ticket in our internal system.

    Args:
        title: Brief title for the ticket
        description: Detailed description of the issue
        priority: Priority level (low, medium, high, critical)
    """
    ticket = ticket_system.create(
        title=title, description=description, priority=priority
    )
    return {"id": ticket.id, "url": ticket.url, "status": "created"}

@mcp.resource("docs://api-reference")
def get_api_docs() -> str:
    """Return the full API reference documentation."""
    return open("api-reference.md").read()

# Run the server
if __name__ == "__main__":
    mcp.run()  # Starts stdio transport by default`,
      },
      {
        title: 'TypeScript Implementation',
        content:
          'The TypeScript MCP SDK provides a similar experience for Node.js developers. Tools are defined with Zod schemas for parameter validation.',
        codeExample: `// npm install @modelcontextprotocol/sdk zod
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport }
  from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-custom-server",
  version: "1.0.0",
});

// Define a tool
server.tool(
  "search_docs",
  "Search documentation for relevant articles",
  {
    query: z.string().describe("The search query"),
    limit: z.number().default(5).describe("Max results"),
  },
  async ({ query, limit }) => {
    const results = await mySearchEngine.search(query, limit);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(results, null, 2),
      }],
    };
  }
);

// Define a resource
server.resource(
  "docs://api-reference",
  "API Reference Documentation",
  "text/markdown",
  async () => ({
    contents: [{
      uri: "docs://api-reference",
      text: await fs.readFile("api-reference.md", "utf-8"),
    }],
  })
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);`,
      },
      {
        title: 'Testing & Deployment',
        content:
          'Once your server is built, you can test it locally and then deploy it for others to use.',
        bulletPoints: [
          'Test with the MCP Inspector: npx @modelcontextprotocol/inspector',
          'Add to Claude Code config for real-world testing',
          'Publish to npm for easy distribution',
          'For remote deployment, use HTTP+SSE transport instead of stdio',
          'Add authentication for sensitive tools (API keys, OAuth)',
          'Document your tools clearly -- the AI reads your descriptions to decide when to use them',
        ],
        codeExample: `# Test your server with the MCP Inspector
npx @modelcontextprotocol/inspector python my_server.py

# Or test with Claude Code by adding to settings
# ~/.claude/settings.json
{
  "mcpServers": {
    "my-server": {
      "command": "python",
      "args": ["path/to/my_server.py"]
    }
  }
}

# For remote deployment (HTTP transport)
# Python:
mcp.run(transport="sse", host="0.0.0.0", port=8080)`,
      },
      {
        title: 'Best Practices',
        content:
          'Follow these guidelines to build MCP servers that work reliably with AI agents.',
        bulletPoints: [
          'Write clear, specific tool descriptions -- the AI uses them to decide when to call your tool',
          'Use descriptive parameter names and add descriptions to every parameter',
          'Return structured data (JSON) rather than free-form text when possible',
          'Handle errors gracefully and return helpful error messages',
          'Keep tools focused -- one tool per action, not mega-tools that do everything',
          'Add rate limiting and input validation for production servers',
        ],
      },
    ],
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

export function getArticle(id: string): WikiArticle | undefined {
  return WIKI_ARTICLES.find(a => a.id === id);
}

export function getArticlesByCategory(category: WikiCategory): WikiArticle[] {
  return WIKI_ARTICLES.filter(a => a.category === category);
}

export function searchArticles(query: string): WikiArticle[] {
  const q = query.toLowerCase();
  return WIKI_ARTICLES.filter(a =>
    a.title.toLowerCase().includes(q) ||
    a.subtitle.toLowerCase().includes(q) ||
    a.tags.some(t => t.includes(q))
  );
}

export function getCategoryInfo(): WikiCategoryInfo[] {
  return WIKI_CATEGORIES.map(c => ({
    ...c,
    articleCount: WIKI_ARTICLES.filter(a => a.category === c.id).length,
  }));
}

export function getRelatedArticles(articleId: string): WikiArticle[] {
  const article = getArticle(articleId);
  if (!article) return [];
  return WIKI_ARTICLES.filter(a =>
    a.id !== articleId && a.tags.some(t => article.tags.includes(t))
  ).slice(0, 5);
}

function normalizeWikiText(value: string): string {
  return value.toLowerCase();
}

function getArticleSearchHaystack(article: WikiArticle): string {
  const sectionText = article.content.map(section =>
    [
      section.title,
      section.content,
      ...(section.bulletPoints || []),
      section.codeExample || '',
      section.tableData ? `${section.tableData.headers.join(' ')} ${section.tableData.rows.flat().join(' ')}` : '',
    ].join(' ')
  ).join(' ');

  return normalizeWikiText([
    article.title,
    article.subtitle,
    article.category,
    article.tags.join(' '),
    sectionText,
  ].join(' '));
}

function scoreArticleForQuery(article: WikiArticle, query: string): number {
  const q = normalizeWikiText(query).trim();
  if (!q) return 0;

  let score = 0;
  const haystack = getArticleSearchHaystack(article);
  const title = normalizeWikiText(article.title);
  const subtitle = normalizeWikiText(article.subtitle);
  const tags = article.tags.map(normalizeWikiText);
  const category = normalizeWikiText(article.category);
  const terms = q.split(/\s+/).filter(Boolean);

  if (title.includes(q)) score += 16;
  if (subtitle.includes(q)) score += 10;
  if (category.includes(q)) score += 6;
  if (tags.some(tag => tag.includes(q))) score += 12;
  if (haystack.includes(q)) score += 6;

  for (const term of terms) {
    if (title.includes(term)) score += 5;
    if (subtitle.includes(term)) score += 3;
    if (category.includes(term)) score += 2;
    if (tags.some(tag => tag.includes(term))) score += 4;
    if (haystack.includes(term)) score += 1;
  }

  return score;
}

export function getRelevantWikiArticles(query: string, limit = 6): WikiArticle[] {
  const ranked = WIKI_ARTICLES
    .map(article => ({ article, score: scoreArticleForQuery(article, query) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit).map(item => item.article);
}

export function getWikiArticleReferences(query: string, limit = 5): WikiArticleReference[] {
  return getRelevantWikiArticles(query, limit).map(article => ({
    id: article.id,
    title: article.title,
    subtitle: article.subtitle,
    category: article.category,
    color: article.color,
    tags: article.tags,
  }));
}

export function buildWikiKnowledgeBundle(query: string, limit = 6): string {
  const relevant = getRelevantWikiArticles(query, limit);
  const categorySummary = getCategoryInfo()
    .map(category => `${category.title}: ${category.articleCount}`)
    .join(' | ');

  const intro = `Wiki coverage map: ${categorySummary}.`;

  if (relevant.length === 0) {
    return `${intro}\nNo direct article match found for this query, but the AI wiki covers agents, models, frameworks, design, open-source AI, MCP, foundations, and landscape topics.`;
  }

  const articleLines = relevant.map(article => {
    const keySection = article.content[0];
    const bullets = (keySection?.bulletPoints || []).slice(0, 3).join(' | ');
    return [
      `- ${article.title} [${article.category}]`,
      `  Subtitle: ${article.subtitle}`,
      `  Tags: ${article.tags.slice(0, 6).join(', ')}`,
      `  Key point: ${keySection?.content || article.subtitle}`,
      bullets ? `  Highlights: ${bullets}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return `${intro}\nRelevant wiki articles for "${query}":\n${articleLines}`;
}

export function buildWikiSearchResponse(query: string, limit = 5): string {
  const relevant = getRelevantWikiArticles(query, limit);

  if (relevant.length === 0) {
    return `**AI Wiki Search:** No strong match for "${query}".\n\nTry a more specific topic like:\n- MCP\n- Playwright\n- coding agents\n- model families\n- evals\n- retrieval\n- multimodal\n- support agents`;
  }

  const lines = relevant.map((article, index) => {
    const keySection = article.content[0];
    const highlights = (keySection?.bulletPoints || []).slice(0, 2).join(' | ');
    return [
      `${index + 1}. **${article.title}** [${article.category}]`,
      `   ${article.subtitle}`,
      keySection?.content ? `   Key point: ${keySection.content}` : '',
      highlights ? `   Highlights: ${highlights}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return `**AI Wiki Search: "${query}"**\n\n${lines}`;
}
