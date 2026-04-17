# Top Coding Languages And Product Strategy

Date: 2026-04-10

## Why this matters

The Underground Circle is already strongest in TypeScript because the product is built on Expo and React Native, but the app is now broad enough that language choice should be deliberate instead of accidental. Different parts of the product want different strengths:

- TypeScript for fast product iteration and shared web/mobile logic
- Python for AI workflows, education, data tooling, and agent-friendly scripting
- Go for backend utilities, MCP servers, and fast network services
- Rust for memory-safe performance-critical local runtimes
- Swift and Kotlin for native mobile depth
- SQL for analytics, recommendations, and school progress intelligence

The point is not to chase a "best" language. It is to map each language to the jobs it is unusually good at.

## What the current sources say

These sources use different methodologies, so they do not agree on a single universal ranking:

- Stack Overflow Developer Survey 2024 still shows JavaScript as the most broadly used language among all respondents, with Python, SQL, and TypeScript also highly used.
- GitHub Octoverse 2024 shows Python overtaking JavaScript on GitHub, with TypeScript in third place and Go and Rust continuing to rise.
- RedMonk's January 2025 rankings still place JavaScript, Python, and Java at the top, which reinforces how durable incumbent ecosystems remain.
- TIOBE's early 2026 index keeps Python at number one and continues to rank C, Java, C++, C#, and JavaScript highly, reflecting demand across education, systems, and enterprise software.

That split is useful. It means language strategy should be based on product shape, developer workflow, and deployment needs, not on one leaderboard.

## The top languages that matter most for this app

### TypeScript / JavaScript

Why it matters:

- It is the app's current center of gravity.
- It supports shared UI logic across mobile and web.
- It keeps iteration speed high for product work, experiments, onboarding, and feature polish.

How it can improve Underground Circle:

- keep the main app, UI kits, wiki surfaces, and school experiences in one maintainable language family
- make agent-generated edits safer because the codebase already has TypeScript structure
- support richer real-time collaboration and MCP dashboards without adding stack sprawl

Recommended use:

- Continue to treat TypeScript as the default product language.
- Tighten types around wiki, school, office, and agent state models.
- Prefer adding app-native content systems in TypeScript before creating detached side services.

### Python

Why it matters:

- Python remains dominant for AI, notebooks, data work, and educational accessibility.
- It is the most natural language for AI labs, prompt experiments, and lightweight automations.

How it can improve Underground Circle:

- power beginner-friendly coding lessons and school labs
- enable notebook-backed demos for prompts, embeddings, moderation, and retrieval
- support local agent tools, content analysis, curriculum generation, and research utilities

Recommended use:

- Add optional Python-based school projects and agent tools, not core app rendering.
- Use it for educational notebooks, data pipelines, embeddings experiments, and prototype MCP servers.

### Go

Why it matters:

- Go is strong for small, fast, deployable services.
- It is well suited to MCP servers, sync daemons, background jobs, and infrastructure tooling.

How it can improve Underground Circle:

- create lean backend workers for indexing, notifications, or event fanout
- build stable local bridges and agent-control services with low operational overhead
- improve responsiveness for network-heavy companion services

Recommended use:

- Use Go for service-side utilities and operational tooling where startup time and simplicity matter.

### Rust

Why it matters:

- Rust brings memory safety and high performance.
- It is increasingly relevant for secure local runtimes and systems that handle sensitive data or large context windows.

How it can improve Underground Circle:

- support a future local agent runtime with stronger safety guarantees
- handle performance-heavy parsing, sync, indexing, or secure secret-handling layers
- make desktop-native or extension-side tooling safer over time

Recommended use:

- Reserve Rust for places where safety or performance is truly the bottleneck.
- Do not move normal product UI or CRUD logic into Rust.

### Java and C#

Why they matter:

- Both remain extremely relevant in enterprise environments.
- They matter if Underground Circle wants to integrate with schools, districts, or enterprise systems built on established stacks.

How they can improve Underground Circle:

- make enterprise integration strategy more realistic
- enable connectors into existing SIS, LMS, identity, and reporting systems
- help position the app for institutional deployments instead of only creator workflows

Recommended use:

- Treat them as interoperability targets first.
- Build integrations and docs that play well with Java/C# ecosystems instead of rewriting the product in them.

### Kotlin and Swift

Why they matter:

- They are the path to deeper platform-native mobile experiences.

How they can improve Underground Circle:

- improve advanced camera, audio, notifications, widgets, and background behaviors
- unlock premium-feeling device-native school or office interactions

Recommended use:

- Keep Expo and React Native for most product surface area.
- Use Kotlin/Swift surgically for native modules where platform depth creates real user value.

### SQL

Why it matters:

- SQL is not just storage. It is product intelligence.

How it can improve Underground Circle:

- better curriculum progress queries
- stronger wiki search, recommendation, and analytics layers
- clearer reporting on engagement, retention, and learning outcomes

Recommended use:

- Invest in better query design, materialized views, and reporting flows around school progress, wiki discovery, and agent memory retrieval.

## Recommended language strategy for Underground Circle

### Core stack

- TypeScript for the app, interaction design, and shared product logic
- SQL for analytics, recommendations, and structured knowledge retrieval

### Expansion stack

- Python for AI education, research, notebooks, and agent experimentation
- Go for MCP services, bridges, and operational tooling

### Specialized stack

- Rust for security- and performance-sensitive local systems
- Swift/Kotlin for native device capabilities that Expo cannot cover well

## What to build next

1. Add a "Language Strategy" lane to the Wiki and school section so users learn why tools are built in different languages.
2. Add beginner Python projects in the school section because that is the clearest educational on-ramp into AI building.
3. Create an MCP server starter path in either Python or Go to teach agent infrastructure, not just prompting.
4. Add analytics and recommendation improvements in SQL so the school and wiki sections feel smarter and more personalized.
5. Keep TypeScript as the product default to avoid unnecessary stack fragmentation.

## Sources

- Stack Overflow Developer Survey 2024, Technology: https://survey.stackoverflow.co/2024/technology
- GitHub Octoverse 2024: https://github.blog/news-insights/octoverse/octoverse-2024/
- GitHub language update for 2025 contributor counts: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/
- RedMonk Programming Language Rankings, January 2025: https://redmonk.com/sogrady/2025/06/18/language-rankings-1-25/
- TIOBE Index: https://www.tiobe.com/tiobe-index/
