# Expert Domain Knowledge for 14 Professional Archetypes
## Deep Research for AI Agent System Prompts

---

## 1. SENIOR SOFTWARE ENGINEER

### Key Frameworks & Methodologies

**SOLID Principles** (Robert C. Martin, 2000; acronym coined by Michael Feathers, 2004):
- **Single Responsibility Principle**: A class should have only one reason to change
- **Open/Closed Principle**: Open for extension, closed for modification
- **Liskov Substitution Principle**: Subtypes must be substitutable for their base types
- **Interface Segregation Principle**: No client should be forced to depend on methods it does not use
- **Dependency Inversion Principle**: Depend on abstractions, not concretions

**Gang of Four Design Patterns** (Gamma, Helm, Johnson, Vlissides, 1994):
- Creational: Factory Method, Abstract Factory, Builder, Prototype, Singleton
- Structural: Adapter, Bridge, Composite, Decorator, Facade, Flyweight, Proxy
- Behavioral: Chain of Responsibility, Command, Iterator, Mediator, Memento, Observer, State, Strategy, Template Method, Visitor

**Clean Architecture** (Robert C. Martin): Dependency Rule — source code dependencies point inward only. Layers: Entities > Use Cases > Interface Adapters > Frameworks & Drivers.

**Domain-Driven Design** (Eric Evans): Bounded Contexts, Aggregates, Entities, Value Objects, Domain Events, Ubiquitous Language, Anti-Corruption Layer.

### Debugging Methodologies
- **Scientific Method Debugging**: Hypothesize > Predict > Test > Analyze. Formulate a theory about the bug, predict observable behavior, design a test, confirm or refute.
- **Wolf Fence Algorithm**: Binary search through code/time to isolate the bug. Split the problem space in half repeatedly.
- **Rubber Duck Debugging**: Explain the problem out loud line-by-line to expose flawed assumptions.
- **Delta Debugging**: Systematically narrowing the difference between a working and failing state.
- **Strategic Breakpoints**: Place breakpoints at invariant boundaries, not random locations. Use conditional breakpoints to avoid noise.

### Code Review Practices

**Google's Code Review System**:
- Separate LGTM (code correctness) from Readability Approval (style/language conformance)
- Readability reviewers are certified per-language after training
- Expectation: feedback within 1-5 hours, small CLs (changelists)
- **The Beyonce Rule**: "If you liked it, you should have put a CI test on it" — if infrastructure changes break your product but your CI didn't catch it, it's not the infra team's fault

**Ship/Show/Ask** (Martin Fowler):
- **Ship**: Merge directly to mainline without review (trivial, safe changes)
- **Show**: Open PR, merge immediately, notify team for knowledge sharing
- **Ask**: Open PR, wait for review before merging (complex, risky, novel)

**Review Heuristics**:
- Start with a skim to assess intent and scope, then deep-dive on correctness, scalability, coupling, edge cases
- Ask questions rather than dictate ("What happens when X is null?" > "Add a null check here")
- Review for: correctness, readability, performance, security, test coverage, API design

### Anti-Patterns to Avoid
- **Premature Optimization**: Optimize only when measured bottlenecks exist
- **Cargo Cult Programming**: Ritual inclusion of patterns/code without understanding why
- **Golden Hammer**: Using one tool/pattern for everything regardless of fit
- **Lava Flow**: Dead/legacy code left in because nobody knows if it's still needed
- **Spaghetti Code**: No clear architecture, tangled dependencies, hard to trace execution
- **God Object**: One class that knows/does too much
- **Shotgun Surgery**: One change requires modifications across many unrelated classes

### Communication Patterns
- Use RFCs (Request for Comments) for significant design decisions
- Write ADRs (Architecture Decision Records) for choices with long-term implications
- Prefer asynchronous communication for code reviews; synchronous for design discussions
- Frame feedback as observations and questions, not commands
- "I notice X — was that intentional?" over "Change X to Y"

---

## 2. SYSTEMS ARCHITECT

### Key Frameworks & Methodologies

**C4 Model** (Simon Brown, 2006-2011):
- **Level 1 — Context Diagram**: Bird's eye view showing the system, its users, and external systems it interacts with. Simple, non-technical, for all stakeholders.
- **Level 2 — Container Diagram**: Major technology choices and distribution of responsibilities. Shows applications, databases, message queues, file systems. For developers and ops.
- **Level 3 — Component Diagram**: Zooms into a single container showing its internal structural building blocks (components), responsibilities, and interactions. For developers.
- **Level 4 — Code Diagram**: Implementation details (UML class diagrams). Usually auto-generated, rarely maintained manually.

**TOGAF** (The Open Group Architecture Framework):
- Enterprise-level framework for IT architecture governance
- Architecture Development Method (ADM): iterative cycle through Preliminary > Architecture Vision > Business Architecture > Information Systems Architecture > Technology Architecture > Opportunities & Solutions > Migration Planning > Implementation Governance > Architecture Change Management
- Broader and more holistic than arc42 — covers the entire organization's IT architecture, not just a single system

**arc42** (Gernot Starke & Peter Hruschka):
- 12-chapter template for architecture documentation:
  1. Introduction & Goals, 2. Constraints, 3. Context & Scope, 4. Solution Strategy, 5. Building Block View, 6. Runtime View, 7. Deployment View, 8. Crosscutting Concepts, 9. Architecture Decisions, 10. Quality Requirements, 11. Risks & Technical Debt, 12. Glossary
- Combine with C4 for visualization: arc42 for structure, C4 for diagrams

**Architecture Decision Records (ADRs)**:
- Format: Title, Status (Proposed/Accepted/Deprecated/Superseded), Context, Decision, Consequences
- Michael Nygard's lightweight ADR format is the most common
- Record architecturally significant decisions: those affecting structure, quality characteristics, dependencies, interfaces, or construction techniques
- Keep a decision log as part of the codebase (e.g., `/docs/adr/`)

### Industry-Standard Tools & Practices
- Diagramming: Structurizr (C4-native), PlantUML, Mermaid, draw.io, Lucidchart
- Documentation-as-Code: Arc42 templates in AsciiDoc/Markdown, version-controlled with the codebase
- Architecture Fitness Functions: Automated tests that verify architecture constraints (e.g., ArchUnit, dependency-cruiser)
- Include documentation in Definition of Done; involve the whole team, not just the architect

### Decision-Making Heuristics
- **Last Responsible Moment**: Defer decisions until the cost of not deciding exceeds the cost of deciding
- **Reversibility**: Prefer reversible decisions (two-way doors) over irreversible ones
- **Conway's Law**: System structure mirrors org structure; design both intentionally
- **YAGNI** (You Aren't Gonna Need It): Don't build for hypothetical future requirements
- **Architectural Quantum**: The smallest independently deployable unit with high functional cohesion

### Anti-Patterns
- **Architecture Astronaut**: Over-abstracting without solving real problems
- **Ivory Tower Architecture**: Designing without developer input or implementation feedback
- **Resume-Driven Development**: Choosing tech for career benefit rather than problem fit
- **Big Ball of Mud**: No discernible architecture at all
- **Vendor Lock-in**: Coupling core business logic to a specific vendor's APIs

### Communication Patterns
- Use different diagram levels for different audiences (C4 Level 1 for executives, Level 3 for developers)
- Architecture Review Boards for governance, but lightweight and enabling, not gatekeeping
- Tech Radar (ThoughtWorks format): Adopt, Trial, Assess, Hold — for communicating technology choices
- Lunch-and-learn sessions for architectural decisions and trade-off discussions

---

## 3. DEVOPS ENGINEER

### Key Frameworks & Methodologies

**SRE (Site Reliability Engineering)** — Google's approach:
- **SLI** (Service Level Indicator): A quantitative measure of some aspect of the level of service (e.g., request latency, error rate, throughput)
- **SLO** (Service Level Objective): A target value or range for an SLI (e.g., 99.9% of requests < 200ms)
- **SLA** (Service Level Agreement): A business contract with consequences for missing SLOs
- **Error Budgets**: 1 - SLO = error budget. A 99.9% SLO gives 0.1% error budget. If budget is exhausted, halt feature work and focus on reliability. Balances innovation velocity with reliability.
- **Toil**: Work that is manual, repetitive, automatable, tactical, devoid of enduring value, and scales linearly with service growth. Target: keep toil < 50% of SRE time.
- **Blameless Postmortems**: Focus on contributing causes, not individual blame. Assume everyone had good intentions and did the right thing with available information. Document: timeline, impact, root causes, action items, lessons learned.

**GitOps** — Core Principles:
- Git as single source of truth for declarative infrastructure and application state
- Pull-based deployment: the cluster pulls desired state from Git (not push-based)
- Continuous reconciliation: when live state drifts from desired state, automatically correct
- Self-healing infrastructure
- Tools: **ArgoCD** (rich web UI, multi-tenancy, multi-cluster), **Flux** (lightweight, Kubernetes-native)

**Chaos Engineering** (Netflix Simian Army, Principles of Chaos Engineering):
- Steady-state hypothesis: define normal behavior, then inject failure
- Tools: LitmusChaos, Chaos Mesh, Gremlin, AWS Fault Injection Simulator
- Start small: begin with known weaknesses, expand to unknown unknowns
- Run in production (with safeguards) — staging doesn't replicate real conditions
- GameDays: scheduled chaos exercises with the whole team

**Platform Engineering**:
- Build Internal Developer Platforms (IDPs) providing self-service golden paths
- Reduce cognitive load for product developers
- Backstage (Spotify) for developer portals, service catalogs
- Crossplane for infrastructure abstraction
- Platform-as-a-Product mindset: treat internal developers as customers

### Industry-Standard Tools
- CI/CD: GitHub Actions, GitLab CI, Jenkins, Tekton, Dagger
- IaC: Terraform/OpenTofu, Pulumi, AWS CDK, Crossplane
- Containers/Orchestration: Docker, Kubernetes, Helm, Kustomize
- Observability (Three Pillars): Metrics (Prometheus/Grafana), Logs (Loki/ELK), Traces (Jaeger/Tempo)
- Incident Management: PagerDuty, OpsGenie, Rootly, incident.io

### Decision-Making Heuristics
- **Automate the second time**: First time — do it manually and learn. Second time — automate it.
- **Blast radius thinking**: Every change should have a bounded blast radius. Canary > blue-green > rolling.
- **Immutable infrastructure**: Replace, don't patch. Cattle, not pets.
- **Shift left**: Security scanning, testing, policy enforcement in CI, not production.
- **Four Key Metrics** (DORA): Deployment Frequency, Lead Time for Changes, Change Failure Rate, Time to Restore Service.

### Anti-Patterns
- **ClickOps**: Making changes through cloud console UIs instead of IaC
- **Snowflake Servers**: Manually configured, irreproducible environments
- **Alert Fatigue**: Too many low-signal alerts lead to ignoring real incidents
- **Toil Acceptance**: Accepting manual work as "just how it is" instead of automating
- **Heroing**: One person always fixing production issues alone, creating single points of failure

### Communication Patterns
- Incident Commander role during outages: single point of coordination
- Status pages for external communication (Statuspage, Cachet)
- Runbooks: step-by-step incident response procedures, version-controlled
- Post-incident review meetings: structured, blameless, action-item driven
- Architecture Decision Records for infrastructure changes

---

## 4. SECURITY ENGINEER

### Key Frameworks & Methodologies

**NIST Cybersecurity Framework (CSF) 2.0**:
- Six core functions: **Govern** (new in 2.0), **Identify**, **Protect**, **Detect**, **Respond**, **Recover**
- Govern: Establish governance structures for cybersecurity risk management aligned with business objectives
- Identify: Asset management, risk assessment, supply chain risk management
- Protect: Access control, awareness training, data security, platform security
- Detect: Continuous monitoring, anomaly detection, adverse event analysis
- Respond: Incident management, reporting, mitigation, communication
- Recover: Recovery planning, execution, communication
- All functions should be addressed concurrently and continuously

**OWASP Top 10 (2025)**:
1. Broken Access Control (still #1, found in 100% of tested applications)
2. Security Misconfiguration (rose from #5)
3. Vulnerable and Outdated Components
4. Injection (including SQL, NoSQL, OS, LDAP)
5. Insecure Design
6. Cryptographic Failures
7. Software Supply Chain Failures (NEW — reflects dependency risks)
8. Identification and Authentication Failures
9. Security Logging and Monitoring Failures
10. Server-Side Request Forgery (SSRF)

**Threat Modeling Frameworks**:
- **STRIDE** (Microsoft, 1999): Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege. Best during early design phases.
- **DREAD** (Microsoft, discontinued 2008 due to inconsistent ratings): Damage Potential, Reproducibility, Exploitability, Affected Users, Discoverability. Used for risk scoring.
- **MITRE ATT&CK**: Knowledge base of adversary tactics, techniques, and procedures (TTPs). Used for operational threat modeling and detection engineering. 14 tactics from Initial Access to Impact.
- **MITRE ATLAS** (2026): Extension for securing AI/ML systems.
- Integration pattern: Use STRIDE for high-level design-phase modeling, ATT&CK for identifying specific threats and building detections.

**Core Security Principles**:
- **CIA Triad**: Confidentiality, Integrity, Availability — the foundation
- **Defense in Depth**: Multiple layers of security controls; no single point of failure
- **Zero Trust Architecture**: "Never trust, always verify." Authenticate and authorize every user, device, and network flow. No implicit trust based on network location.
- **Principle of Least Privilege**: Grant minimum necessary access for minimum necessary time
- **Secure by Design**: Build security into architecture from the start, not bolt it on after

### Industry-Standard Tools & Practices
- SAST: Semgrep, SonarQube, CodeQL (static analysis)
- DAST: OWASP ZAP, Burp Suite (dynamic analysis)
- SCA: Snyk, Dependabot, Trivy (software composition / dependency scanning)
- SIEM: Splunk, Microsoft Sentinel, Elastic Security
- Secrets Management: HashiCorp Vault, AWS Secrets Manager
- Penetration Testing: Metasploit, Kali Linux, Cobalt Strike
- Compliance: SOC 2, ISO 27001, PCI DSS, HIPAA, GDPR

### Decision-Making Heuristics
- **Assume breach**: Design systems as if the attacker is already inside
- **Trust boundaries**: Map where trust changes in your architecture; these are your attack surfaces
- **Risk = Likelihood x Impact**: Prioritize mitigations by actual risk, not fear
- **Shift-left security**: Security scanning in CI/CD pipelines, not just periodic pentests
- **Supply chain verification**: SBOM (Software Bill of Materials), SLSA framework for build provenance

### Anti-Patterns
- **Security Theater**: Visible but ineffective security measures
- **Security by Obscurity**: Relying on secrecy of design rather than strength of controls
- **Excessive Permissions**: Granting admin access because it's easier than scoping
- **Alert Fatigue**: Too many false positives leading to ignored real threats
- **Compliance-Driven Security**: Treating compliance checkboxes as security strategy

### Communication Patterns
- Threat model documents shared during design reviews
- Security advisories with CVSS scores and actionable remediation steps
- Risk registers with likelihood/impact matrices for leadership
- Incident reports following defined templates (timeline, scope, impact, remediation, lessons)
- Security champions program: embedded security advocates in each development team

---

## 5. DESIGNER

### Key Frameworks & Methodologies

**Atomic Design** (Brad Frost):
- Five hierarchical levels:
  - **Atoms**: Basic HTML elements — labels, inputs, buttons, colors, fonts
  - **Molecules**: Simple groups of atoms functioning as a unit — search form (label + input + button)
  - **Organisms**: Complex components composed of molecules/atoms — header, product card grid
  - **Templates**: Page-level compositions showing content structure
  - **Pages**: Specific instances of templates with real content
- **Design Tokens**: Named properties defining visual attributes (colors, spacing, typography). Foundational layer that makes components reusable and themeable across platforms.

**Gestalt Principles** (Wertheimer, Koffka, Kohler, 1920s):
- **Proximity**: Objects close together are perceived as a group
- **Similarity**: Similar elements (color, shape, size) are perceived as related
- **Closure**: The brain fills in missing parts to perceive a complete shape
- **Continuity**: Elements on a line or curve are perceived as more related than those not
- **Figure/Ground**: Visual field separates into prominent figures and receding background
- **Common Region**: Elements within a shared boundary are perceived as grouped
- **Common Fate**: Elements moving in the same direction are perceived as a group

**Nielsen's 10 Usability Heuristics** (Jakob Nielsen, 1994):
1. Visibility of system status
2. Match between system and the real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition rather than recall
7. Flexibility and efficiency of use
8. Aesthetic and minimalist design
9. Help users recognize, diagnose, and recover from errors
10. Help and documentation

**WCAG 2.2** (W3C, 2023) — Nine new success criteria:
- Focus Not Obscured (Minimum/Enhanced) — keyboard focus must be visible
- Focus Appearance — visible focus indicators on interactive elements
- Dragging Movements — provide simple pointer alternatives to drag actions
- Target Size (Minimum) — at least 24x24 CSS pixels for touch targets
- Consistent Help — help resources accessible and consistent across pages
- Redundant Entry — don't ask for same info twice in a session
- Accessible Authentication (Minimum/Enhanced) — don't rely on cognitive function tests

**Design Systems**: Material Design 3 (Google), Human Interface Guidelines (Apple), Fluent Design (Microsoft), Carbon Design System (IBM), Polaris (Shopify)

### Industry-Standard Tools
- Design: Figma, Sketch, Adobe XD
- Prototyping: Figma Prototyping, ProtoPie, Framer
- Handoff: Figma Dev Mode, Zeplin
- Research: Maze, UserTesting, Hotjar, Lookback
- Accessibility: axe DevTools, Stark, WAVE

### Decision-Making Heuristics
- **Double Diamond** (Design Council): Discover > Define > Develop > Deliver. Diverge then converge, twice.
- **Jobs to Be Done** (Christensen): Design for the "job" the user is "hiring" the product to do
- **Progressive Disclosure**: Show only what's needed at each step; reveal complexity gradually
- **Fitts's Law**: Time to reach a target is a function of distance and size — make important actions large and close
- **Hick's Law**: Decision time increases with number of choices — reduce options to reduce cognitive load
- **Jakob's Law**: Users spend most of their time on other sites; they prefer your site to work the same way

### Anti-Patterns
- **Aesthetic Usability Effect**: Beautiful designs mask usability problems in testing
- **Feature Creep**: Adding features without pruning, leading to bloated interfaces
- **Consistency Hobgoblin**: Forcing consistency when context demands different treatment
- **Designing for Yourself**: Assuming your preferences represent users' needs
- **Dark Patterns**: Manipulative UI that tricks users (confirmshaming, roach motels, hidden costs)

### Communication Patterns
- Design critiques: structured feedback sessions with "I like / I wish / What if" format
- Design specs with annotated mockups, interaction states, responsive breakpoints
- User journey maps showing emotional states, pain points, and opportunities
- Accessibility audit reports with WCAG conformance levels and remediation priorities

---

## 6. SENIOR WRITER

### Key Frameworks & Methodologies

**Style Guides**:
- **AP Stylebook** (Associated Press): Standard for journalism, news, shorter-form content. No Oxford comma. Spell out numbers < 10. Spaces around em dashes. Prioritizes speed and clarity.
- **Chicago Manual of Style (CMOS)**: Standard for publishing, academic, and long-form work. Uses Oxford comma. Spell out numbers 0-100. No spaces around em dashes. Prioritizes elegance and form.
- **Microsoft Writing Style Guide**: Tech writing standard. Plain language, conversational tone, active voice, present tense.
- **Google Developer Documentation Style Guide**: Technical documentation standard. Second person ("you"), present tense, active voice, short sentences.

**Readability Scores**:
- **Flesch-Kincaid Grade Level**: Most widely used. Measures approximate reading grade level based on average sentence length and word complexity. Target: 7th-8th grade for general audience.
- **Flesch Reading Ease**: 0-100 scale. 60-70 = plain English. 30-50 = college level. 70-80 = 7th grade.
- **Gunning Fog Index**: Estimates years of education needed. Wall Street Journal = ~10-11. TV Guide = ~6. Target < 12 for most content.
- **Hemingway Editor**: Highlights dense sentences, passive voice, adverbs, and complex words. Not a single formula but a composite assessment.

**Content Strategy Frameworks**:
- **Content Pillars / Hub and Spoke**: Core topic pages (hubs) linking to detailed subtopic content (spokes). Establishes topical authority.
- **AIDA**: Attention, Interest, Desire, Action — classic copywriting framework
- **PAS**: Problem, Agitation, Solution — direct response framework
- **StoryBrand** (Donald Miller): Customer as hero, brand as guide. 7-part framework: Character > Problem > Guide > Plan > Call to Action > Success > Failure.
- **Content Design** (Sarah Winters/Richards): Start with user needs, not what the organization wants to say. Evidence-based writing.

### Industry-Standard Tools
- Writing: Google Docs, Notion, Ulysses, iA Writer
- Editing: Grammarly, Hemingway Editor, ProWritingAid
- SEO: Clearscope, SurferSEO, Ahrefs Content Explorer
- CMS: WordPress, Contentful, Sanity, Strapi
- Style enforcement: Vale (linting for prose), textlint

### Decision-Making Heuristics
- **Inverted Pyramid**: Most important information first, supporting details follow, background last
- **One Idea Per Paragraph**: Each paragraph should make exactly one point
- **Active Voice Default**: Use passive only when the actor is unknown, irrelevant, or when emphasis demands it
- **Show Don't Tell**: Concrete examples over abstract claims
- **Cut 30% Rule**: First draft is always too long. Cut ruthlessly.
- **Specific > Vague**: "Revenue grew 23% in Q3" beats "Revenue grew significantly"

### Anti-Patterns
- **Jargon Creep**: Using insider terminology without defining it for the audience
- **Burying the Lede**: Putting the most important information deep in the content
- **Passive Voice Abuse**: "Mistakes were made" obscures accountability
- **Nominalizations**: Turning verbs into nouns ("implementation" vs. "implement") — deadens prose
- **Weasel Words**: "Many experts believe" — unattributed, unfalsifiable claims
- **SEO Stuffing**: Keyword density over reader experience

### Communication Patterns
- Content briefs before writing: audience, intent, key messages, CTA, SEO targets
- Edit in passes: structural edit > line edit > copy edit > proofread
- Style guide adherence documentation for team consistency
- Tone and voice guidelines: separate from style — personality vs. grammar rules

---

## 7. GROWTH MARKETER

### Key Frameworks & Methodologies

**AARRR Pirate Metrics** (Dave McClure, 2007):
- **Acquisition**: How do users find you? Channels, CAC, attribution
- **Activation**: Do users have a great first experience? Time-to-value, activation rate
- **Retention**: Do users come back? DAU/MAU, retention curves, cohort analysis
- **Referral**: Do users tell others? Viral coefficient (k-factor), NPS
- **Revenue**: Do users pay? ARPU, LTV, conversion rate, expansion revenue

**North Star Framework** (Sean Ellis / Amplitude):
- Identify one metric that represents your product's core value to customers
- If this metric goes up, the business is creating sustainable growth
- Supporting inputs: 3-5 smaller metrics that feed the North Star
- Example: Airbnb's North Star = "nights booked" (not revenue, not signups)

**Sean Ellis Test**: "How would you feel if you could no longer use this product?" If 40%+ say "very disappointed," you have product-market fit. Below 40% = iterate before scaling.

**Growth Loops** (Brian Balfour / Reforge):
- Replacement for the funnel model — loops compound, funnels are additive
- **Viral Loops**: Users invite others (Slack, Venmo, Dropbox)
- **Content/UGC Loops**: Users create content that attracts new users (Pinterest, YouTube, Stack Overflow)
- **Paid Loops**: Revenue reinvested into acquisition (subscription fees fund ads)
- Key insight: "Growth loops compound momentum, whereas funnels run out of fuel"

**Four Fits Framework** (Brian Balfour): Product-Market Fit, Product-Channel Fit, Channel-Model Fit, Model-Market Fit — all four must align for sustainable growth.

**HEART Framework** (Google): Happiness, Engagement, Adoption, Retention, Task Success — for measuring user experience at scale.

### Industry-Standard Tools
- Analytics: Amplitude, Mixpanel, PostHog, Google Analytics 4
- Experimentation: Optimizely, LaunchDarkly, Statsig, GrowthBook
- CRM/Engagement: Braze, Customer.io, Intercom, HubSpot
- Attribution: Segment, mParticle, AppsFlyer
- Surveys: Typeform, Hotjar, Sprig

### Decision-Making Heuristics
- **ICE Scoring**: Impact (1-10) x Confidence (1-10) x Ease (1-10) — prioritize experiments
- **One Metric That Matters (OMTM)**: Focus the team on a single metric per sprint/quarter
- **Power User Curve**: Plot DAU/MAU distribution — smile curve = healthy, L-shape = concerning
- **Payback Period**: How long until a user's LTV exceeds CAC? Target < 12 months for SaaS.
- **Rule of 40**: For SaaS — revenue growth rate + profit margin should exceed 40%

### Anti-Patterns
- **Vanity Metrics**: Tracking total signups instead of active users, page views instead of engagement
- **Premature Scaling**: Pouring money into acquisition before retention is proven
- **Growth Hacking Theater**: Running random experiments without a systematic framework
- **Feature-Led Growth Confusion**: Shipping features and calling it growth strategy
- **Attribution Obsession**: Over-investing in attribution models at the expense of experimentation

### Communication Patterns
- Growth models: spreadsheet models showing how inputs drive the North Star
- Experiment briefs: Hypothesis > Metric > Audience > Duration > Success Criteria
- Weekly growth reviews: experiment results, learnings, next bets
- Cohort reports: retention curves by signup week/month showing trends over time

---

## 8. PRODUCT MANAGER

### Key Frameworks & Methodologies

**Dual-Track Agile** (Marty Cagan & Jeff Patton, ~2012):
- Run Discovery and Delivery in parallel, continuously
- **Discovery Track**: Determine what to build. Rapid prototyping, user interviews, experiments. Output: validated product backlog items.
- **Delivery Track**: Build what's been validated. Sprints, engineering, shipping. Output: working software.
- Teams must not separate discovery from delivery — the same team does both.

**Continuous Discovery Habits** (Teresa Torres, 2021):
- **Opportunity Solution Tree (OST)**: Visual framework starting with a desired outcome at the top, branching into opportunities (customer needs/pain points), then solutions for each opportunity, then assumption tests for each solution.
- **Product Trio**: Product Manager + Designer + Engineer collaborate on discovery together — not PM alone.
- Weekly touchpoints with customers (not quarterly research projects)
- **Assumption Mapping**: Plot assumptions on Impact vs. Evidence axes. Test high-impact, low-evidence assumptions first.

**Kano Model** (Noriaki Kano, 1984):
- **Must-Be (Basic)**: Expected features. Absence = dissatisfaction. Presence = neutral. (Example: login working)
- **Performance (One-Dimensional)**: More = more satisfaction, proportionally. (Example: load speed)
- **Attractive (Delighters)**: Unexpected features that delight. Absence = neutral. (Example: personalized recommendations)
- **Indifferent**: No impact on satisfaction either way. Don't invest here.
- **Reverse**: Causes dissatisfaction when present. Remove or make optional.
- Key insight: Delighters decay into Performance, and Performance decays into Must-Be over time.

**RICE Prioritization**: Reach x Impact x Confidence / Effort — scoring model for backlog items.

**Jobs to Be Done** (Christensen/Ulwick): "People don't want a quarter-inch drill. They want a quarter-inch hole." Focus on the outcome, not the solution.

### Industry-Standard Tools
- Discovery: ProductBoard, Productplan, Miro, FigJam
- Analytics: Amplitude, Mixpanel, FullStory, LogRocket
- Roadmapping: Linear, Jira, Shortcut, Notion
- User Research: UserTesting, Maze, Dovetail, Grain
- Feature Flags: LaunchDarkly, Statsig, Flagsmith

### Decision-Making Heuristics
- **Opportunity Cost Thinking**: Every "yes" is a "no" to something else. What are you not building?
- **Two-Way vs. One-Way Doors** (Bezos): Reversible decisions should be made quickly. Irreversible ones deserve deliberation.
- **Impact vs. Effort Matrix**: Quick wins (high impact, low effort) first, then big bets, then fill-ins. Avoid thankless tasks (low impact, high effort).
- **Disagree and Commit**: Once a decision is made, everyone commits fully regardless of initial disagreement.
- **Customer Problem Stack Ranking**: Rank problems by frequency x severity, not feature requests.

### Anti-Patterns
- **Feature Factory**: Shipping features without measuring outcomes
- **HiPPO** (Highest Paid Person's Opinion): Letting seniority override data and user research
- **Requirements Handoff**: Writing specs and throwing them over the wall to engineering
- **Solution Jumping**: Starting with a solution instead of understanding the problem
- **Roadmap as Promise**: Treating the roadmap as a commitment rather than a plan that adapts

### Communication Patterns
- PRDs (Product Requirements Documents) or One-Pagers with context, problem, goals, non-goals, success metrics
- Product reviews: demo > metrics > learnings > next steps
- Stakeholder updates: What we shipped, what we learned, what's next, what we need
- Say "no" with context: "We're not doing X because Y is higher priority based on Z data"

---

## 9. TECH LEAD

### Key Frameworks & Methodologies

**Patrick Lencioni's Five Dysfunctions of a Team** (2002):
Pyramid model (bottom to top — must build sequentially):
1. **Absence of Trust**: Without vulnerability-based trust, team members hide weaknesses and mistakes
2. **Fear of Conflict**: Without trust, teams avoid passionate debate and default to artificial harmony
3. **Lack of Commitment**: Without healthy conflict, decisions lack buy-in and team members phone it in
4. **Avoidance of Accountability**: Without commitment, peers won't call each other on poor performance
5. **Inattention to Results**: Without accountability, individuals prioritize personal goals over team outcomes

**Will Larson's Staff Engineer Archetypes** (staffeng.com):
- **Tech Lead**: Guides approach and execution of a particular team. Partners with 1-3 managers in a focused area.
- **Architect**: Responsible for direction, quality, and approach within a critical area. Combines technical depth with organizational leadership.
- **Solver**: Digs into arbitrarily complex problems and finds a path forward. Bounces between hotspots.
- **Right Hand**: Extends an executive's attention, borrowing their scope and authority for complex organizations.

**Tuckman's Stages of Group Development** (Bruce Tuckman, 1965; adjourning added 1977):
1. **Forming**: Polite, independent, motivated but uninformed. Learning goals and boundaries.
2. **Storming**: Conflict emerges. Frustration about roles, expectations, constraints. Essential phase — don't suppress it.
3. **Norming**: Conflict resolved, roles clarified, team cohesion develops. Members value different perspectives.
4. **Performing**: True interdependence. Team can work independently, in subgroups, or as a unit. High trust and competence.
5. **Adjourning**: Task completion and team dissolution.
- Key insight: Teams regress to earlier stages when members change or during periods of disruption. Not linear.

### Industry-Standard Tools & Practices
- Technical vision documents and technology radar
- Architecture Decision Records (ADRs) for key technical choices
- 1:1s with engineers for mentoring and career development
- Sprint retrospectives (Start/Stop/Continue format)
- Tech debt tracking (e.g., tech debt register with business impact estimates)

### Decision-Making Heuristics
- **Lead by Context, Not Control**: Set the direction and constraints, let the team figure out the implementation
- **Manage Technical Risk**: Spike on unknowns early. Prototype before committing.
- **Force Multiplier Thinking**: Your impact is measured by the team's output, not your individual code
- **Delegate Decisions Downward**: Only escalate decisions to yourself when the blast radius is large or the decision is irreversible
- **Build the Bench**: If you're the only one who can do something, you're a bottleneck, not a leader

### Anti-Patterns
- **Hero Programmer**: Doing all the hard work yourself instead of enabling the team
- **Seagull Management**: Flying in, making a mess, flying out
- **Bike-Shedding** (Law of Triviality): Spending disproportionate time on trivial issues
- **Technical Gatekeeping**: Requiring your personal approval on everything
- **Ivory Tower Tech Lead**: Making decisions without understanding the on-the-ground reality

### Communication Patterns
- Engineering RFCs for significant technical decisions — solicit broad input, then decide
- Weekly team syncs: blockers, technical decisions pending, cross-team dependencies
- Skip-level 1:1s to maintain connection with ICs when managing through managers
- Brag documents: help reports articulate their accomplishments for performance reviews
- Written communication for decisions; verbal for debates and brainstorms

---

## 10. ACCOUNTABILITY COACH

### Key Frameworks & Methodologies

**BJ Fogg's Behavior Model** (B=MAP):
- **Behavior = Motivation + Ability + Prompt** (all three must occur simultaneously)
- Make behavior tiny (2 minutes or less) to reduce the ability threshold
- Anchor new habits to existing routines ("After I pour my morning coffee, I will...")
- **Celebrate immediately**: The emotion felt while doing the behavior is what wires the habit
- Shine: when a behavior becomes automatic and feels natural
- Design for the behavior you want, not the outcome you want

**James Clear's Atomic Habits** (Four Laws of Behavior Change):
1. **Make it Obvious** (Cue): Implementation intentions ("I will [BEHAVIOR] at [TIME] in [LOCATION]"), habit stacking, environment design
2. **Make it Attractive** (Craving): Temptation bundling, join a culture where desired behavior is normal
3. **Make it Easy** (Response): Reduce friction, two-minute rule, prime the environment
4. **Make it Satisfying** (Reward): Immediate rewards, habit tracking, "never miss twice" rule
- To break bad habits: invert each law (make it invisible, unattractive, difficult, unsatisfying)
- **1% Better Every Day**: 1.01^365 = 37.78. Tiny gains compound.
- **Identity-Based Habits**: Focus on who you want to become, not what you want to achieve. "I am a runner" vs. "I want to run."

**Motivational Interviewing** (Miller & Rollnick):
- **OARS Technique**:
  - **Open-ended questions**: "What would it look like if you achieved this?"
  - **Affirmations**: Acknowledge strengths and past successes
  - **Reflective listening**: Mirror and clarify what the client is saying
  - **Summarizing**: Recap to reinforce motivation and paint the bigger picture
- **Spirit of MI**: Partnership, acceptance, compassion, evocation (draw out rather than impose)
- **Change Talk**: Listen for and amplify language indicating desire, ability, reason, and need for change
- **Sustain Talk**: Language supporting the status quo — acknowledge without amplifying

**Transtheoretical Model / Stages of Change** (Prochaska & DiClemente):
1. **Precontemplation**: Not yet considering change. Coach raises awareness without pushing.
2. **Contemplation**: Aware of need for change but ambivalent. Explore ambivalence.
3. **Preparation**: Intending to act soon. Help develop a plan.
4. **Action**: Actively modifying behavior. Support skill-building.
5. **Maintenance**: Sustaining change. Reinforce relapse prevention.
6. **Termination**: Change is fully integrated. No temptation to revert.

### Industry-Standard Tools & Practices
- Habit trackers: physical (dot journals) or digital (Habitica, Streaks, Way of Life)
- Accountability partnerships: structured check-ins with specific protocols
- SMART goals: Specific, Measurable, Achievable, Relevant, Time-bound
- Weekly reviews: What worked, what didn't, what to adjust
- Implementation intentions: "When X happens, I will do Y"

### Decision-Making Heuristics
- **Meet people where they are**: Match your coaching approach to their Stage of Change
- **Autonomy support**: People comply with external demands but commit to self-chosen goals
- **Keystone Habits**: Identify the one habit that creates a cascade of other positive changes (exercise often is one)
- **Environment > Willpower**: Design the environment to make the right behavior the default
- **Process over Outcome**: Celebrate showing up consistently, not just hitting targets

### Anti-Patterns
- **Shame-Based Accountability**: Using guilt or social pressure instead of intrinsic motivation
- **All-or-Nothing Thinking**: Missing one day means the streak is "broken" and why bother
- **Goal Inflation**: Setting goals too ambitious too soon — violates the "tiny" principle
- **Accountability Without Autonomy**: Telling people what to do instead of helping them discover their own motivation
- **Focusing on Motivation**: Motivation is unreliable. Focus on systems, environment, and identity instead.

### Communication Patterns
- Ask before telling: "Would it be helpful if I shared an observation?"
- Reflect back their own words and motivations
- Celebrate effort, not just results
- Use "scale questions": "On a scale of 1-10, how important is this to you? What makes it a 6 and not a 4?"
- Weekly check-in structure: Wins > Challenges > Commitments > Support Needed

---

## 11. PHILOSOPHER

### Key Frameworks & Methodologies

**Kahneman's Dual-Process Theory** (Thinking, Fast and Slow, 2011):
- **System 1**: Fast, automatic, intuitive, effortless, emotional. Pattern-matching based on experience. Prone to cognitive biases.
- **System 2**: Slow, deliberate, logical, effortful, calculating. Activated for complex decisions, novel situations, and when System 1 encounters a surprise.
- **Key Biases**:
  - Anchoring: Over-relying on the first piece of information encountered
  - Availability Heuristic: Judging probability by ease of recall
  - Substitution: Answering an easier question when faced with a hard one
  - Loss Aversion: Losses loom larger than equivalent gains (~2x)
  - WYSIATI (What You See Is All There Is): Constructing coherent stories from limited information
  - Planning Fallacy: Systematically underestimating time, costs, and risks
  - Overconfidence: Excessive certainty in one's judgments and predictions

**Charlie Munger's Latticework of Mental Models**:
- Core thesis: Narrow thinking leads to predictable mistakes. Collect ~80-90 models from all major fields to handle ~90% of life's challenges.
- **Inversion**: Flip problems upside down. Instead of "How do I succeed?" ask "How do I fail?" then avoid those things.
- **Circle of Competence**: Know what you know, and more critically, know what you don't. Stay within your circle or expand it deliberately.
- **Second-Order Thinking**: Consider the consequences of the consequences. "And then what?"
- **Multidisciplinary Thinking**: "To a man with a hammer, everything looks like a nail." Carry multiple frameworks.
- **Probabilistic Thinking**: Think in probabilities, not certainties. Weight expected values.
- Other key models: Margin of Safety, Occam's Razor, Hanlon's Razor, Sunk Cost fallacy, Incentive-Caused Bias, Confirmation Bias, Survivorship Bias, Map Is Not the Territory

**Nassim Taleb's Antifragility Framework**:
- **Fragile-Robust-Antifragile Triad**: Fragile (harmed by volatility) > Robust (unchanged) > Antifragile (benefits from volatility)
- **Barbell Strategy**: Keep most exposure extremely safe, with small calculated bets on high-upside risks. Avoid the mediocre middle.
- **Via Negativa**: Knowing what to remove is more robust than knowing what to add. Subtraction > addition.
- **Skin in the Game**: Those who make decisions must bear the consequences. Asymmetric risk-taking without skin in the game is unethical.
- **Lindy Effect**: The longer something non-perishable has survived, the longer it's expected to survive. A book in print for 100 years will likely survive another 100.
- **Black Swans**: Rare, high-impact, unpredictable events. You cannot predict them, but you can build systems that benefit from them (antifragile) rather than being destroyed by them (fragile).
- **Green Lumber Fallacy**: You don't need to understand the theory to be good at the practice. Practical knowledge > theoretical knowledge.

### Decision-Making Heuristics
- **Pre-Mortem** (Gary Klein): Before starting a project, imagine it failed spectacularly. Work backward to identify why.
- **Reversibility Test**: For reversible decisions, bias toward action. For irreversible decisions, deliberate carefully.
- **Regret Minimization** (Bezos): "When I'm 80, will I regret not doing this?" For big decisions.
- **Falsification** (Karl Popper): Try to disprove your hypothesis, not confirm it. Seek disconfirming evidence.
- **Steel-Manning**: Before disagreeing, construct the strongest possible version of the opposing argument.

### Anti-Patterns
- **Confirmation Bias**: Seeking only evidence that supports existing beliefs
- **Narrative Fallacy**: Constructing post-hoc stories to explain random events
- **Sunk Cost Fallacy**: Continuing because of investment rather than future value
- **Authority Bias**: Accepting claims because of who said them, not the evidence
- **Dunning-Kruger Effect**: The least competent overestimate their ability the most

### Communication Patterns
- Socratic Method: Lead through questions, not assertions
- "Consider the opposite" — deliberately argue the other side
- Thought experiments to test ethical and logical boundaries
- Steel-man before you critique
- Distinguish between "I believe" (confidence) and "the evidence shows" (epistemic humility)

---

## 12. STRATEGIST

### Key Frameworks & Methodologies

**Hamilton Helmer's 7 Powers** (7 Powers: The Foundations of Business Strategy):
Power requires both a **Benefit** (lower cost or higher value) AND a **Barrier** (prevents competitors from replicating). The seven powers:
1. **Scale Economies**: Reduced cost per unit as volume increases. Barrier: prohibitive cost of replication.
2. **Network Economies**: Value increases with each user. Barrier: winner-take-most dynamics.
3. **Counter-Positioning**: A newcomer adopts a superior business model that the incumbent can't copy without cannibalizing existing business.
4. **Switching Costs**: Customers face costs (financial, procedural, relational) when changing to a competitor.
5. **Branding**: Higher perceived value due to brand association. Built over time and not replicable quickly.
6. **Cornered Resource**: Exclusive access to a valuable resource (talent, patents, data, regulatory approval).
7. **Process Power**: Complex, embedded organizational processes that are difficult to replicate (e.g., Toyota Production System).

**Roger Martin's Playing to Win** (Strategy Choice Cascade):
Five integrated choices:
1. **Winning Aspiration**: What does winning look like? Purpose and ambition.
2. **Where to Play**: Geographic markets, customer segments, product categories, channels, verticals.
3. **How to Win**: The competitive advantage — differentiation or cost leadership within your chosen playing field.
4. **Capabilities**: What must be true for the strategy to work? Core capabilities required.
5. **Management Systems**: Structures, processes, and measures that support the strategy.
- Where-to-Play and How-to-Win are a matched pair — useless without each other.
- Continuously toggle between the five; not a linear, one-time exercise.

**Ben Thompson's Aggregation Theory** (Stratechery, 2015):
- The internet has disaggregated the value chain: suppliers, distributors, consumers
- **Aggregators** win by owning the customer relationship with zero marginal cost per user
- Three defining traits: (1) direct user relationship, (2) zero marginal serving costs, (3) demand-driven multi-sided networks with decreasing acquisition costs
- **Virtuous cycle**: Best experience > most users > most suppliers > even better experience
- **Super-Aggregators**: Multi-sided markets (users + suppliers + advertisers) with zero marginal cost on all sides. Only Google and Facebook qualify.
- **Platforms vs. Aggregators**: Platforms (iOS, Windows) provide tools for third-party suppliers who retain the customer relationship. Aggregators (Google, Facebook) own the customer relationship.
- Winner-take-all effects: aggregators serve all users and become better with each additional user.

### Additional Strategic Frameworks
- **Porter's Five Forces**: Competitive Rivalry, Supplier Power, Buyer Power, Threat of Substitution, Threat of New Entry
- **Wardley Mapping** (Simon Wardley): Map components by value chain position and evolution stage (Genesis > Custom > Product > Commodity). Reveals strategic moves.
- **Blue Ocean Strategy** (Kim & Mauborgne): Create uncontested market space. Value innovation: simultaneously pursue differentiation AND low cost.
- **Disruptive Innovation** (Christensen): Low-end or new-market footholds that incumbents ignore until it's too late.

### Decision-Making Heuristics
- **Strategy Is Choice**: Strategy is not a to-do list. It's choosing what NOT to do.
- **Moat Identification**: What makes this defensible over 10+ years? If you can't answer, there's no moat.
- **Invert the Strategy**: What would a competitor do to destroy us? Then defend against that.
- **Think in Decades, Plan in Years, Execute in Weeks**: Long-term vision, medium-term planning, short-term execution.
- **Uncommon Sense**: If everyone agrees with your strategy, it's probably not a strategy — it's a consensus.

### Anti-Patterns
- **Strategy-Free Execution**: "Our strategy is to execute better" — that's not a strategy
- **Straddling**: Trying to match a competitor's positioning while maintaining your own — you end up in no-man's land
- **Plan vs. Strategy**: A plan is a list of actions. A strategy is a theory of how to win.
- **Strategy as Vision**: "Be the best X" is aspiration, not strategy
- **Analysis Paralysis**: Gathering more data instead of making choices under uncertainty

### Communication Patterns
- Strategy on a page: Winning aspiration, where to play, how to win — fits on one slide
- "What would have to be true?" — Lazy Man's approach to testing strategic options (Roger Martin)
- Competitive landscape maps showing positioning
- Narrative memos (Amazon-style 6-pager) for strategic proposals
- War-gaming exercises: role-play competitors' responses to your strategy

---

## 13. RESEARCHER

### Key Frameworks & Methodologies

**Cochrane Methodology** (Cochrane Collaboration):
- Gold standard for systematic reviews of healthcare interventions
- Steps: Define question (PICO: Population, Intervention, Comparison, Outcome) > Search comprehensively > Screen > Extract data > Assess risk of bias > Synthesize > GRADE the evidence
- Ten principles: collaboration, multidisciplinarity, bias reduction, incorporation of new evidence, relevance, quality, continuity
- Cochrane Risk of Bias tool (RoB 2) for randomized controlled trials
- GRADE framework for rating certainty of evidence: High, Moderate, Low, Very Low

**PRISMA** (Preferred Reporting Items for Systematic Reviews and Meta-Analyses):
- Reporting guideline (not a methodological guideline — it guides HOW you report, not HOW you conduct)
- PRISMA 2020 Statement: updated flow diagram showing identification > screening > eligibility > inclusion
- 27-item checklist covering: title, abstract, rationale, objectives, eligibility criteria, information sources, search strategy, selection process, data collection, study risk of bias, synthesis methods, results, discussion, funding
- Complementary to Cochrane: Cochrane for conduct, PRISMA for reporting

**Bradford Hill Criteria** (Sir Austin Bradford Hill, 1965):
Nine viewpoints for evaluating epidemiological evidence of causation:
1. **Strength**: Stronger associations more likely causal
2. **Consistency**: Same findings across populations, study designs, and times
3. **Specificity**: One-to-one relationship between cause and outcome
4. **Temporality**: Exposure must precede outcome (the only absolute criterion)
5. **Biological Gradient**: Dose-response relationship
6. **Plausibility**: A plausible biological mechanism exists
7. **Coherence**: Consistent with existing knowledge of the disease
8. **Experiment**: Experimental evidence supports causation
9. **Analogy**: Similar causes produce similar effects
- Critical caveat: Hill explicitly stated these are "viewpoints," not a checklist. No single criterion is necessary or sufficient except temporality.

**Bayesian Reasoning**:
- **Prior**: What you believed before seeing new evidence
- **Likelihood**: How probable the observed data is under different hypotheses
- **Posterior**: Updated belief after incorporating the evidence (Prior x Likelihood / Evidence)
- **Base Rate**: The prevalence of the condition in the population — ignoring it is the most common reasoning error ("base rate neglect")
- **Sequential Updating**: Each posterior becomes the prior for the next round of evidence
- Application: Helps researchers avoid overinterpreting single studies. A surprising result against a low prior should not dramatically shift beliefs.

### Additional Research Methodologies
- **Randomized Controlled Trials (RCTs)**: Gold standard for causal inference. Random allocation removes confounding.
- **Meta-Analysis**: Statistical synthesis of multiple studies to estimate overall effect size
- **Pre-Registration**: Declaring hypotheses, methods, and analysis plans before data collection (OSF, ClinicalTrials.gov)
- **p-values and Effect Sizes**: p < 0.05 is a threshold, not truth. Always report effect sizes and confidence intervals.
- **Replication Crisis**: Understanding that single studies are insufficient; replication is essential.

### Industry-Standard Tools
- Literature Search: PubMed, Scopus, Web of Science, Google Scholar, Cochrane Library
- Reference Management: Zotero, Mendeley, EndNote
- Data Analysis: R (tidyverse, brms), Python (scipy, statsmodels), SPSS, Stata
- Systematic Review: Covidence, Rayyan, RevMan
- Pre-Registration: OSF (Open Science Framework), AsPredicted
- Visualization: ggplot2, matplotlib, forest plots, funnel plots

### Decision-Making Heuristics
- **Extraordinary Claims Require Extraordinary Evidence** (Sagan Standard)
- **Effect Size > Significance**: A statistically significant but tiny effect may be practically meaningless
- **Replication Before Revolution**: Don't overturn established knowledge based on one study
- **Consider the Base Rate**: Before interpreting a positive result, ask "What's the prior probability?"
- **Correlation ≠ Causation**: But also know when correlation IS evidence for causation (using Bradford Hill)
- **Publication Bias Awareness**: Positive results are published more; absence of evidence is not evidence of absence
- **Funnel Plot Asymmetry**: Visual tool for detecting publication bias in meta-analyses

### Anti-Patterns
- **p-Hacking**: Running multiple analyses until p < 0.05 is found
- **HARKing**: Hypothesizing After Results are Known — presenting post-hoc findings as a priori
- **Cherry-Picking**: Selecting only studies or data points that support your thesis
- **Texas Sharpshooter Fallacy**: Drawing a target around clusters of data points after the fact
- **Ecological Fallacy**: Drawing individual-level conclusions from group-level data
- **Survivorship Bias**: Studying only survivors (successful companies, published studies)

### Communication Patterns
- Abstract structured as: Background, Methods, Results, Conclusions
- Forest plots for meta-analysis results
- Sensitivity analyses reported transparently
- Limitations section that demonstrates intellectual honesty, not a pro forma paragraph
- Pre-registration reports distinguish confirmatory from exploratory analyses

---

## 14. WISE MENTOR

### Key Frameworks & Methodologies

**Bloom's Taxonomy** (Benjamin Bloom, 1956; revised Anderson & Krathwohl, 2001):
Three domains of learning:
- **Cognitive** (knowledge-based): Remember > Understand > Apply > Analyze > Evaluate > Create (revised hierarchy, lowest to highest)
- **Affective** (emotion-based): Receiving > Responding > Valuing > Organizing > Characterizing
- **Psychomotor** (action-based): Perception > Set > Guided Response > Mechanism > Complex Overt Response > Adaptation > Origination
- Key insight: Most teaching/testing stays at Remember/Understand. Mentoring should push toward Analyze/Evaluate/Create.
- Use the taxonomy to ask increasingly sophisticated questions as the learner develops.

**Dreyfus Model of Skill Acquisition** (Stuart & Hubert Dreyfus, 1980):
Five (sometimes six) stages:
1. **Novice**: Follows rules rigidly. No discretionary judgment. Needs step-by-step instructions.
2. **Advanced Beginner**: Recognizes some situational aspects. Still mostly rule-following. Limited context awareness.
3. **Competent**: Develops plans and routines. Can prioritize. Makes conscious choices. Takes responsibility.
4. **Proficient**: Sees situations holistically. Recognizes patterns. Intuition develops. Decision-making speeds up.
5. **Expert**: Transcends rules. Acts from deep intuitive understanding. Can no longer fully articulate their reasoning.
6. **Mastery** (sometimes added): Generates new knowledge in the domain. Teaches and innovates.
- Key insight: Teaching methods must match the learner's stage. Rules for novices; case studies for competent; Socratic questioning for proficient; autonomy for experts.

**Kolb's Experiential Learning Cycle** (David Kolb, 1984):
Four-stage cycle (can enter at any stage):
1. **Concrete Experience**: Doing or encountering something new
2. **Reflective Observation**: Reflecting on the experience — what happened and why
3. **Abstract Conceptualization**: Forming theories or generalizations from reflections
4. **Active Experimentation**: Testing theories in new situations, leading to new experiences
- **Learning Styles** (derived): Diverging (feel/watch), Assimilating (think/watch), Converging (think/do), Accommodating (feel/do)
- Key insight: Complete the full cycle. Most people get stuck at their preferred stage.

**Andragogy** (Malcolm Knowles' Six Assumptions About Adult Learners):
1. **Self-Directed**: Adults move from dependency to self-direction. They want autonomy in learning.
2. **Experience as Resource**: Adults bring accumulated experience that serves as a rich learning resource. They also have biases and habits to unlearn.
3. **Readiness to Learn**: Tied to social roles and life situations. Adults learn when they need to.
4. **Orientation to Learning**: Problem-centered, not subject-centered. "How does this solve my real problem?"
5. **Internal Motivation**: Internal motivators (achievement, self-actualization, mastery) > external motivators (grades, promotions).
6. **Need to Know**: Adults need to understand WHY they should learn something before investing effort.

### Additional Mentoring Frameworks
- **Situational Leadership** (Hersey & Blanchard): Match leadership style (Directing, Coaching, Supporting, Delegating) to the follower's development level
- **Zone of Proximal Development** (Vygotsky): The gap between what a learner can do alone and what they can do with guidance. Optimal learning happens in this zone.
- **Scaffolding**: Provide temporary support structures that are progressively removed as competence grows
- **Growth Mindset** (Carol Dweck): Ability can be developed through dedication and hard work. Praise effort and strategy, not talent.

### Decision-Making Heuristics
- **Diagnose Before Prescribing**: Understand the learner's current stage (Dreyfus) before choosing a teaching approach
- **Ask, Don't Tell**: Questions develop thinking capacity. Answers create dependency.
- **Challenge Matched to Skill**: Too easy = boredom. Too hard = anxiety. Match challenge to current ability (flow state, Csikszentmihalyi).
- **Teach the Fishing**: Every direct answer you give is a missed opportunity to teach problem-solving
- **Progressive Autonomy**: Gradually increase autonomy as evidence of competence accumulates

### Anti-Patterns
- **Information Dumping**: Overwhelming learners with everything you know instead of what they need now
- **Expert Blind Spot**: Forgetting what it was like to not know something — skipping foundational steps
- **Rescue Reflex**: Jumping in with the answer when the learner is struggling (struggling IS learning)
- **One-Size-Fits-All Teaching**: Using the same approach for novices and experts
- **Mentor as Hero**: Making the mentoring about your story rather than their growth
- **Premature Abstraction**: Teaching principles before the learner has enough experience to ground them

### Communication Patterns
- **Socratic Questioning**: "What do you think would happen if...?" / "What's your reasoning?" / "How would you approach this differently?"
- **Reflect Before Redirect**: "I hear you saying X. That's interesting. Have you considered Y?"
- **Calibrated Questions**: Questions calibrated to the learner's Dreyfus stage. Novices: "What did the documentation say?" Experts: "What's the trade-off you're optimizing for?"
- **Storytelling**: Share relevant experiences as illustrations, not prescriptions. "In my experience..." followed by "but your situation may be different."
- **Celebrate Growth, Not Just Results**: "I noticed you handled that differently than last time — what shifted?"
- **Hold the Silence**: Ask a question and wait. Discomfort in silence is where thinking happens.
