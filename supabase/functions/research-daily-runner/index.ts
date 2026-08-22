import { corsHeaders, createServiceRoleClient, errResponse, jsonResponse, getAuthenticatedUser, getRequiredEnv } from "../_shared/edge.ts";

type ResearchProfile = {
  key: string;
  title: string;
  query: string;
  spiritIds: string[];
  tags: string[];
};

type ArxivEntry = {
  title: string;
  summary: string;
  url: string;
  published: string | null;
  authors: string[];
};

type KnowledgeSourceCard = {
  title: string;
  summary: string;
  content: string;
  sourceTitle: string;
  sourceUrl: string;
  tags: string[];
  evidenceScore: number;
};

type SecondBrainKnowledgeProfile = ResearchProfile & {
  kind: "arxiv" | "curated";
  cadence: "daily" | "weekly";
  maxEntries: number;
  noteTitle: string;
  noteSummary: string;
  noteTags: string[];
  sourceCards?: KnowledgeSourceCard[];
};

type SecondBrainTarget = {
  circleId: string;
  userId: string;
  visibility: "private" | "circle_shared";
};

const PROFILE_DEFS: ResearchProfile[] = [
  {
    key: "deep_learning_frontier",
    title: "Deep Learning Frontier",
    query: '(all:"deep learning" OR all:"foundation model" OR all:"representation learning") AND (cat:cs.LG OR cat:cs.AI OR cat:cs.CV)',
    spiritIds: ["ai-researcher", "sr-engineer", "architect"],
    tags: ["deep-learning", "foundation-models", "representation-learning"],
  },
  {
    key: "agent_systems_and_evals",
    title: "Agent Systems And Evals",
    query: '(all:"AI agent" OR all:"language agent" OR all:"tool use" OR all:"evaluation" OR all:"interpretability") AND (cat:cs.AI OR cat:cs.CL OR cat:cs.SE)',
    spiritIds: ["ai-researcher", "coding-agent", "researcher", "architect", "qa-engineer"],
    tags: ["agents", "evals", "interpretability", "coding-agents"],
  },
  {
    key: "physical_ai_and_robotics",
    title: "Physical AI And Robotics",
    query: '(all:"robotics" OR all:"embodied AI" OR all:"vision-language-action" OR all:"physical AI") AND (cat:cs.RO OR cat:cs.AI OR cat:cs.CV)',
    spiritIds: ["ai-researcher", "architect", "researcher", "sr-engineer"],
    tags: ["robotics", "physical-ai", "embodied-ai", "multimodal"],
  },
  {
    key: "biotech_and_medical_ai",
    title: "Biotech And Medical AI",
    query: '(all:"medical AI" OR all:"clinical AI" OR all:"medical imaging" OR all:"biomedical machine learning" OR all:"drug discovery") AND (cat:q-bio.QM OR cat:cs.AI OR cat:cs.LG OR cat:eess.IV)',
    spiritIds: ["ai-researcher", "researcher", "architect"],
    tags: ["biotech", "medical-ai", "clinical-ai", "medical-imaging", "drug-discovery"],
  },
  {
    key: "open_model_serving_and_infra",
    title: "Open Model Serving And Infra",
    query: '(all:"model serving" OR all:"llm serving" OR all:"inference systems" OR all:"distributed inference" OR all:"vllm" OR all:"serving infrastructure") AND (cat:cs.DC OR cat:cs.SE OR cat:cs.LG)',
    spiritIds: ["ai-researcher", "devops", "architect", "coding-agent", "sr-engineer"],
    tags: ["open-models", "serving", "inference", "infrastructure", "deployment"],
  },
];

const FUTURE_CITY_SOURCE_CARDS: KnowledgeSourceCard[] = [
  {
    title: "Walt Disney's EPCOT as a living city prototype",
    summary: "A design map of Walt Disney's original EPCOT concept: radial city planning, a dense urban core, transit-first movement, underground service logistics, and permanent technology iteration.",
    content: [
      "Design extraction:",
      "- Treat the city as a living prototype, not a finished monument.",
      "- Put pedestrians first by separating people movement from cars, trucks, and service logistics.",
      "- Use a radial layout: high-density center, lower-density neighborhoods, greenbelt edges, and fast transit between layers.",
      "- Put research, industry, education, entertainment, housing, and transportation into one operating system.",
      "- Make the built environment updateable so new materials, systems, and civic technology can be tested in public.",
      "",
      "Implementation idea for .web:",
      "Use this as a future-city cluster that links AI operations, transportation, robotics, climate control, energy, civic governance, and user experience design.",
    ].join("\n"),
    sourceTitle: "D23 EPCOT archive",
    sourceUrl: "https://d23.com/a-to-z/epcot/",
    tags: ["future-cities", "epcot", "urban-design", "systems-design", "retrofuturism"],
    evidenceScore: 0.74,
  },
  {
    title: "Disney monorail as public transport of the future",
    summary: "Current Disney transportation still preserves part of the original future-city pattern: high-frequency grade-separated rail connecting major destinations.",
    content: [
      "Design extraction:",
      "- Make transit legible and emotionally memorable, not just functional.",
      "- Use grade-separated lines to reduce car friction around high-traffic public spaces.",
      "- Treat transportation as part of the experience layer and the infrastructure layer at the same time.",
    ].join("\n"),
    sourceTitle: "Walt Disney World Monorail Transportation",
    sourceUrl: "https://disneyworld.disney.go.com/guest-services/monorail-transportation/",
    tags: ["future-cities", "monorail", "transportation", "mobility"],
    evidenceScore: 0.68,
  },
  {
    title: "Project Tomorrow as a public technology showcase pattern",
    summary: "Modern EPCOT still uses interactive exhibits to make emerging technology understandable to non-specialists.",
    content: [
      "Design extraction:",
      "- Turn technology education into hands-on interaction.",
      "- Let people explore future systems through simulation before the systems become normal infrastructure.",
      "- Use exhibits as feedback loops: public curiosity should shape what the system explains next.",
    ].join("\n"),
    sourceTitle: "Project Tomorrow: Inventing the Wonders of the Future",
    sourceUrl: "https://disneyworld.disney.go.com/attractions/epcot/project-tomorrow-inventing-the-wonders-of-the-future/",
    tags: ["future-cities", "technology-showcase", "public-learning", "epcot"],
    evidenceScore: 0.64,
  },
];

const SECOND_BRAIN_PROFILE_DEFS: SecondBrainKnowledgeProfile[] = [
  {
    key: "ai_technology_watch",
    title: "AI And Technology Watch",
    query: '(all:"artificial intelligence" OR all:"large language model" OR all:"AI agent" OR all:"foundation model" OR all:"robotics" OR all:"human-computer interaction") AND (cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.RO OR cat:cs.HC)',
    spiritIds: ["ai-researcher", "architect", "coding-agent", "sr-engineer"],
    tags: ["ai", "technology", "agents", "frontier-models"],
    kind: "arxiv",
    cadence: "daily",
    maxEntries: 3,
    noteTitle: "AI and Technology Daily Knowledge Intake",
    noteSummary: "Low-cost daily intake of current AI, agent, robotics, HCI, and infrastructure research for the Digital Brain.",
    noteTags: ["second-brain-cron", "ai", "technology", "agents", "automation"],
  },
  {
    key: "universe_science_watch",
    title: "Universe Science Watch",
    query: '(all:"cosmology" OR all:"exoplanet" OR all:"astrophysics" OR all:"space science" OR all:"planetary science") AND (cat:astro-ph.CO OR cat:astro-ph.EP OR cat:astro-ph.GA OR cat:physics.space-ph)',
    spiritIds: ["ai-researcher", "researcher", "architect"],
    tags: ["universe", "space", "astrophysics", "cosmology"],
    kind: "arxiv",
    cadence: "daily",
    maxEntries: 2,
    noteTitle: "Universe Science Knowledge Intake",
    noteSummary: "Broad science intake for cosmology, space systems, planetary science, and cross-domain inspiration.",
    noteTags: ["second-brain-cron", "universe", "science", "space", "cosmology"],
  },
  {
    key: "future_city_design",
    title: "Future City Design",
    query: "Disney EPCOT future city design, urban systems, transportation, prototype communities",
    spiritIds: ["architect", "researcher", "designer", "ai-researcher"],
    tags: ["future-cities", "epcot", "urban-design", "systems-design"],
    kind: "curated",
    cadence: "weekly",
    maxEntries: FUTURE_CITY_SOURCE_CARDS.length,
    noteTitle: "Future City Design: Disney EPCOT Living Blueprint",
    noteSummary: "Starter knowledge cluster for Disney's original future-city ideas and how they map to modern agentic systems, cities, transit, and digital-brain design.",
    noteTags: ["second-brain-cron", "future-cities", "disney", "epcot", "systems-design", "retrofuturism"],
    sourceCards: FUTURE_CITY_SOURCE_CARDS,
  },
];

function stripXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function matchTag(block: string, tag: string): string {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(pattern);
  return match ? stripXml(match[1]) : "";
}

function matchTags(block: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    const value = stripXml(match[1]);
    if (value) out.push(value);
  }
  return out;
}

function parseArxivFeed(xml: string): ArxivEntry[] {
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  return blocks.map((block) => {
    const links = [...block.matchAll(/<link[^>]+href="([^"]+)"[^>]*\/?>/gi)].map((item) => item[1]);
    const primaryUrl = links.find((href) => href.includes("/abs/")) || links[0] || "";
    return {
      title: matchTag(block, "title"),
      summary: matchTag(block, "summary"),
      url: primaryUrl,
      published: matchTag(block, "published") || null,
      authors: matchTags(block, "name"),
    };
  }).filter((entry) => entry.title && entry.url);
}

async function fetchArxivEntries(profile: ResearchProfile): Promise<ArxivEntry[]> {
  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(profile.query)}&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "underground-circle-research-runner/1.0",
    },
  });
  if (!res.ok) {
    throw new Error(`arXiv request failed (${res.status})`);
  }
  const xml = await res.text();
  return parseArxivFeed(xml).slice(0, 5);
}

function buildDigestSummary(profile: ResearchProfile, entries: ArxivEntry[]): string {
  if (entries.length === 0) {
    return `${profile.title} found no fresh items in this run.`;
  }
  return `Automated ${profile.title.toLowerCase()} digest covering ${entries.length} recent papers and reports relevant to ${profile.spiritIds.join(", ")}.`;
}

function buildDigestContent(profile: ResearchProfile, entries: ArxivEntry[]): string {
  const lines = [
    `${profile.title} automated research digest`,
    `Target spirits: ${profile.spiritIds.join(", ")}`,
    `Query: ${profile.query}`,
    "",
    "Recent findings:",
  ];

  for (const [index, entry] of entries.entries()) {
    lines.push(`${index + 1}. ${entry.title}`);
    lines.push(`   Published: ${entry.published || "unknown"}`);
    if (entry.authors.length > 0) lines.push(`   Authors: ${entry.authors.slice(0, 5).join(", ")}`);
    lines.push(`   URL: ${entry.url}`);
    lines.push(`   Summary: ${entry.summary.slice(0, 700)}`);
    lines.push("");
  }

  lines.push("Operational use:");
  lines.push("- Inject into matching SOULs during prompt assembly");
  lines.push("- Surface through the research corpus for AI wiki expansion");
  lines.push("- Keep as draft/reviewed research until a human upgrades confidence");

  return lines.join("\n");
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function digestTitle(profile: ResearchProfile): string {
  return `${profile.title} Daily Digest · ${todayDate()}`;
}

function nextReviewIso(cadence: SecondBrainKnowledgeProfile["cadence"]): string {
  const days = cadence === "weekly" ? 14 : 3;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function insertIfMissingSourceBrief(
  supabase: ReturnType<typeof createServiceRoleClient>,
  profile: ResearchProfile,
  entry: ArxivEntry,
) {
  const { data: existing } = await supabase
    .from("research_documents")
    .select("id")
    .eq("source_url", entry.url)
    .limit(1);

  if (existing && existing.length > 0) {
    return false;
  }

  const { error } = await supabase
    .from("research_documents")
    .insert({
      circle_id: null,
      created_by: null,
      domain_key: "general",
      title: entry.title,
      summary: entry.summary.slice(0, 500),
      content: entry.summary,
      tags: [...profile.tags, ...profile.spiritIds],
      source_type: "paper",
      source_title: "arXiv",
      source_url: entry.url,
      authors: entry.authors,
      publication_date: entry.published ? entry.published.slice(0, 10) : null,
      review_status: "draft",
      evidence_score: 0.68,
      visibility: "public",
      metadata: {
        generated_by: "research-daily-runner",
        profile_key: profile.key,
        relevant_spirits: profile.spiritIds,
        knowledge_target: "wiki_and_souls",
      },
    });

  if (error) {
    throw new Error(`Failed to insert source brief: ${error.message}`);
  }
  return true;
}

async function upsertDigest(
  supabase: ReturnType<typeof createServiceRoleClient>,
  profile: ResearchProfile,
  entries: ArxivEntry[],
) {
  const title = digestTitle(profile);
  const payload = {
    circle_id: null,
    created_by: null,
    domain_key: "general",
    title,
    summary: buildDigestSummary(profile, entries),
    content: buildDigestContent(profile, entries),
    tags: [...profile.tags, ...profile.spiritIds, "daily-research-digest"],
    source_type: "report",
    source_title: "Automated Daily Research Digest",
    source_url: null,
    authors: [],
    publication_date: todayDate(),
    review_status: "reviewed",
    evidence_score: 0.74,
    visibility: "public",
    metadata: {
      generated_by: "research-daily-runner",
      profile_key: profile.key,
      relevant_spirits: profile.spiritIds,
      knowledge_target: "wiki_and_souls",
      source_items: entries.map((entry) => ({
        title: entry.title,
        url: entry.url,
        published: entry.published,
      })),
    },
  };

  const { data: existing } = await supabase
    .from("research_documents")
    .select("id")
    .eq("title", title)
    .limit(1);

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from("research_documents")
      .update(payload)
      .eq("id", existing[0].id);
    if (error) throw new Error(`Failed to update digest: ${error.message}`);
    return existing[0].id as string;
  }

  const { data, error } = await supabase
    .from("research_documents")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(`Failed to insert digest: ${error.message}`);
  return data.id as string;
}

async function assertCircleMember(
  supabase: ReturnType<typeof createServiceRoleClient>,
  circleId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("circle_members")
    .select("circle_id")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

async function resolveSecondBrainTarget(opts: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  body: Record<string, unknown>;
  isServiceRole: boolean;
  user: { id: string } | null;
}): Promise<{ target: SecondBrainTarget | null; error?: Response }> {
  const requestedCircleId = typeof opts.body.circleId === "string" ? opts.body.circleId.trim() : "";
  const requestedUserId = typeof opts.body.userId === "string" ? opts.body.userId.trim() : "";
  const envCircleId = Deno.env.get("SECOND_BRAIN_CRON_CIRCLE_ID") || "";
  const envUserId = Deno.env.get("SECOND_BRAIN_CRON_USER_ID") || "";
  const visibility = opts.body.visibility === "circle_shared" ? "circle_shared" : "private";

  const circleId = requestedCircleId || (opts.isServiceRole ? envCircleId : "");
  const userId = opts.isServiceRole
    ? (requestedUserId || envUserId)
    : (opts.user?.id || "");

  if (!circleId || !userId) {
    return { target: null };
  }

  // Service-role cron may name a target user, but that durable configuration
  // is not permanent Circle authority. Re-prove the exact current membership
  // for both manual and autonomous runs before creating private/shared memory.
  const member = await assertCircleMember(opts.supabase, circleId, userId);
  if (!member) {
    return { target: null, error: errResponse(403, "not_circle_member", "The target account is not a current member of this Circle.") };
  }

  return { target: { circleId, userId, visibility } };
}

async function insertIfMissingKnowledgeSource(
  supabase: ReturnType<typeof createServiceRoleClient>,
  profile: SecondBrainKnowledgeProfile,
  card: KnowledgeSourceCard,
) {
  const { data: existing } = await supabase
    .from("research_documents")
    .select("id")
    .eq("source_url", card.sourceUrl)
    .limit(1);

  if (existing && existing.length > 0) {
    return false;
  }

  const { error } = await supabase
    .from("research_documents")
    .insert({
      circle_id: null,
      created_by: null,
      domain_key: "general",
      title: card.title,
      summary: card.summary,
      content: card.content,
      tags: unique([...profile.tags, ...profile.noteTags, ...card.tags]),
      source_type: "website",
      source_title: card.sourceTitle,
      source_url: card.sourceUrl,
      authors: [],
      publication_date: null,
      review_status: "reviewed",
      evidence_score: card.evidenceScore,
      visibility: "public",
      metadata: {
        generated_by: "research-daily-runner",
        profile_key: profile.key,
        relevant_spirits: profile.spiritIds,
        knowledge_target: "second_brain",
        cadence: profile.cadence,
      },
    });

  if (error) {
    throw new Error(`Failed to insert knowledge source: ${error.message}`);
  }
  return true;
}

function buildKnowledgeContent(
  profile: SecondBrainKnowledgeProfile,
  entries: ArxivEntry[],
  cards: KnowledgeSourceCard[],
): string {
  const lines = [
    `${profile.noteTitle}`,
    `Profile: ${profile.key}`,
    `Cadence: ${profile.cadence}`,
    `Purpose: ${profile.noteSummary}`,
    "",
  ];

  if (entries.length > 0) {
    lines.push("Fresh research signals:");
    for (const [index, entry] of entries.entries()) {
      lines.push(`${index + 1}. ${entry.title}`);
      lines.push(`   Published: ${entry.published || "unknown"}`);
      if (entry.authors.length > 0) lines.push(`   Authors: ${entry.authors.slice(0, 5).join(", ")}`);
      lines.push(`   URL: ${entry.url}`);
      lines.push(`   Summary: ${entry.summary.slice(0, 900)}`);
      lines.push("");
    }
  }

  if (cards.length > 0) {
    lines.push("Curated design/source cards:");
    for (const [index, card] of cards.entries()) {
      lines.push(`${index + 1}. ${card.title}`);
      lines.push(`   Source: ${card.sourceTitle}`);
      lines.push(`   URL: ${card.sourceUrl}`);
      lines.push(`   Summary: ${card.summary}`);
      lines.push(card.content.split("\n").map((line) => `   ${line}`).join("\n"));
      lines.push("");
    }
  }

  lines.push("How the Digital Brain should use this:");
  lines.push("- Keep as reviewed but not fully validated until a human promotes it.");
  lines.push("- Link to relevant app, agent, design, city, AI, and automation clusters.");
  lines.push("- Prefer source-backed summaries over generated claims.");
  lines.push("- Use it as inspiration and context, not as a source of credentials or private data.");

  return lines.join("\n");
}

async function upsertSecondBrainKnowledgeNote(
  supabase: ReturnType<typeof createServiceRoleClient>,
  target: SecondBrainTarget,
  profile: SecondBrainKnowledgeProfile,
  entries: ArxivEntry[],
  cards: KnowledgeSourceCard[],
) {
  const knowledgeKey = `knowledge-cron:${profile.key}`;
  const content = buildKnowledgeContent(profile, entries, cards);
  const sourceUrls = unique([
    ...entries.map((entry) => entry.url),
    ...cards.map((card) => card.sourceUrl),
  ]);
  const payload = {
    circle_id: target.circleId,
    created_by: target.userId,
    source_memory_id: null,
    parent_note_id: null,
    status: "processed",
    note_kind: "web_clip",
    visibility: target.visibility,
    title: `${profile.noteTitle} · ${todayDate()}`,
    content,
    summary: profile.noteSummary,
    tags: unique([...profile.noteTags, ...profile.tags, ...profile.spiritIds]),
    aliases: unique([profile.title, profile.key]),
    importance: profile.key === "future_city_design" ? 0.86 : 0.76,
    metadata: {
      source: "second_brain_knowledge_cron",
      generatedBy: "research-daily-runner",
      knowledgeKey,
      profileKey: profile.key,
      cadence: profile.cadence,
      sourceUrls,
      sourceCount: sourceUrls.length,
      reviewDueAt: nextReviewIso(profile.cadence),
      reviewIntervalDays: profile.cadence === "weekly" ? 14 : 3,
      lastIngestedAt: new Date().toISOString(),
      researchTitles: entries.map((entry) => entry.title),
      curatedTitles: cards.map((card) => card.title),
    },
  };

  const { data: existing, error: existingError } = await supabase
    .from("circle_second_brain_notes")
    .select("id")
    .eq("circle_id", target.circleId)
    .eq("created_by", target.userId)
    .filter("metadata->>knowledgeKey", "eq", knowledgeKey)
    .limit(1);

  if (existingError) {
    throw new Error(`Failed to inspect second brain note: ${existingError.message}`);
  }

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from("circle_second_brain_notes")
      .update(payload)
      .eq("id", existing[0].id);
    if (error) throw new Error(`Failed to update second brain note: ${error.message}`);
    return { id: existing[0].id as string, created: false };
  }

  const { data, error } = await supabase
    .from("circle_second_brain_notes")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw new Error(`Failed to insert second brain note: ${error.message}`);
  return { id: data.id as string, created: true };
}

async function runSecondBrainKnowledgeProfile(
  supabase: ReturnType<typeof createServiceRoleClient>,
  profile: SecondBrainKnowledgeProfile,
  source: string,
  target: SecondBrainTarget | null,
) {
  const runId = await createRun(supabase, profile, source);
  try {
    const entries = profile.kind === "arxiv"
      ? (await fetchArxivEntries(profile)).slice(0, profile.maxEntries)
      : [];
    const cards = profile.sourceCards?.slice(0, profile.maxEntries) || [];
    let documentsCreated = 0;

    for (const entry of entries) {
      const created = await insertIfMissingSourceBrief(supabase, profile, entry);
      if (created) documentsCreated += 1;
    }

    for (const card of cards) {
      const created = await insertIfMissingKnowledgeSource(supabase, profile, card);
      if (created) documentsCreated += 1;
    }

    const digestId = entries.length > 0 ? await upsertDigest(supabase, profile, entries) : null;
    if (digestId) documentsCreated += 1;

    const secondBrainResult = target
      ? await upsertSecondBrainKnowledgeNote(supabase, target, profile, entries, cards)
      : null;

    await completeRun(supabase, runId, {
      status: "succeeded",
      documents_created: documentsCreated + (secondBrainResult?.created ? 1 : 0),
      summary: {
        digest_document_id: digestId,
        second_brain_note_id: secondBrainResult?.id || null,
        second_brain_created: secondBrainResult?.created || false,
        second_brain_targeted: Boolean(target),
        top_titles: [
          ...entries.map((entry) => entry.title),
          ...cards.map((card) => card.title),
        ].slice(0, profile.maxEntries),
      },
    });

    return {
      profile: profile.key,
      ok: true,
      documentsCreated,
      secondBrainNoteId: secondBrainResult?.id || null,
      secondBrainCreated: secondBrainResult?.created || false,
      secondBrainTargeted: Boolean(target),
      titles: [
        ...entries.map((entry) => entry.title),
        ...cards.map((card) => card.title),
      ].slice(0, profile.maxEntries),
    };
  } catch (error) {
    await completeRun(supabase, runId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      summary: {},
    });
    return {
      profile: profile.key,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function createRun(
  supabase: ReturnType<typeof createServiceRoleClient>,
  profile: ResearchProfile,
  source: string,
) {
  const { data, error } = await supabase
    .from("research_agent_runs")
    .insert({
      profile_key: profile.key,
      source,
      status: "running",
      run_date: todayDate(),
      query: profile.query,
      target_spirits: profile.spiritIds,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create run: ${error.message}`);
  return data.id as string;
}

async function completeRun(
  supabase: ReturnType<typeof createServiceRoleClient>,
  runId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("research_agent_runs")
    .update({
      ...patch,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw new Error(`Failed to complete run: ${error.message}`);
}

async function runProfile(
  supabase: ReturnType<typeof createServiceRoleClient>,
  profile: ResearchProfile,
  source: string,
) {
  const runId = await createRun(supabase, profile, source);
  try {
    const entries = await fetchArxivEntries(profile);
    let documentsCreated = 0;
    for (const entry of entries.slice(0, 3)) {
      const created = await insertIfMissingSourceBrief(supabase, profile, entry);
      if (created) documentsCreated += 1;
    }
    const digestId = await upsertDigest(supabase, profile, entries.slice(0, 3));
    documentsCreated += 1;

    await completeRun(supabase, runId, {
      status: "succeeded",
      documents_created: documentsCreated,
      summary: {
        digest_document_id: digestId,
        top_titles: entries.slice(0, 3).map((entry) => entry.title),
      },
    });

    return {
      profile: profile.key,
      ok: true,
      documentsCreated,
      titles: entries.slice(0, 3).map((entry) => entry.title),
    };
  } catch (error) {
    await completeRun(supabase, runId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      summary: {},
    });
    return {
      profile: profile.key,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errResponse(405, "method_not_allowed", "Use POST");
  }

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;
  const user = isServiceRole ? null : await getAuthenticatedUser(req);
  if (!isServiceRole && !user) {
    return errResponse(401, "unauthorized", "Authentication required");
  }

  let body: {
    profiles?: string[];
    source?: string;
    action?: string;
    documentId?: string;
    reviewStatus?: string;
    circleId?: string;
    userId?: string;
    visibility?: string;
  } = {};
  try {
    body = await req.json();
  } catch {}

  const supabase = createServiceRoleClient();

  if (body.action === "set_review_status") {
    if (!user && !isServiceRole) {
      return errResponse(401, "unauthorized", "Authentication required");
    }
    const documentId = body.documentId || "";
    const reviewStatus = body.reviewStatus || "";
    if (!documentId || !["draft", "reviewed", "validated"].includes(reviewStatus)) {
      return errResponse(400, "invalid_request", "documentId and valid reviewStatus are required");
    }

    const { data: existing, error: fetchError } = await supabase
      .from("research_documents")
      .select("metadata, created_by, circle_id, visibility")
      .eq("id", documentId)
      .maybeSingle();

    if (fetchError) {
      return errResponse(500, "fetch_failed", fetchError.message);
    }

    // Enforce the research_documents_update RLS predicate for non-service-role
    // callers, since this service-role client bypasses RLS. The pg_cron /
    // automation-executor path (isServiceRole) stays unblocked.
    if (!isServiceRole) {
      if (!user) {
        return errResponse(401, "unauthorized", "Authentication required");
      }
      if (!existing) {
        return errResponse(404, "not_found", "Document not found");
      }
      const isOwner = existing.created_by && existing.created_by === user.id;
      const isCircleWritable = existing.circle_id &&
        ["circle_shared", "public"].includes(existing.visibility) &&
        await assertCircleMember(supabase, existing.circle_id, user.id);
      if (!isOwner && !isCircleWritable) {
        return errResponse(403, "forbidden", "not allowed to update this document");
      }
    }

    const existingMetadata = (existing?.metadata && typeof existing.metadata === "object")
      ? existing.metadata as Record<string, unknown>
      : {};

    const { error } = await supabase
      .from("research_documents")
      .update({
        review_status: reviewStatus,
        metadata: {
          ...existingMetadata,
          last_review_update_source: isServiceRole ? "service_role" : "manual_ui",
          last_review_updated_at: new Date().toISOString(),
          last_review_updated_by: user?.id || null,
        },
      })
      .eq("id", documentId);

    if (error) {
      return errResponse(500, "update_failed", error.message);
    }

    return jsonResponse({ ok: true, documentId, reviewStatus });
  }

  if (body.action === "seed_second_brain") {
    const targetResult = await resolveSecondBrainTarget({
      supabase,
      body,
      isServiceRole,
      user: user ? { id: user.id } : null,
    });
    if (targetResult.error) return targetResult.error;

    const requestedProfiles = Array.isArray(body.profiles) && body.profiles.length > 0
      ? SECOND_BRAIN_PROFILE_DEFS.filter((profile) => body.profiles!.includes(profile.key))
      : SECOND_BRAIN_PROFILE_DEFS;
    const source = body.source || (isServiceRole ? "second_brain_cron" : "second_brain_manual");
    const results = [];
    for (const profile of requestedProfiles) {
      results.push(await runSecondBrainKnowledgeProfile(supabase, profile, source, targetResult.target));
    }

    return jsonResponse({
      ok: true,
      source,
      target: targetResult.target
        ? {
          circleId: targetResult.target.circleId,
          userId: targetResult.target.userId,
          visibility: targetResult.target.visibility,
        }
        : null,
      profiles: results,
    });
  }

  const requestedProfiles = Array.isArray(body.profiles) && body.profiles.length > 0
    ? PROFILE_DEFS.filter((profile) => body.profiles!.includes(profile.key))
    : PROFILE_DEFS;
  const source = body.source || (isServiceRole ? "service_role" : "manual");

  const results = [];
  for (const profile of requestedProfiles) {
    results.push(await runProfile(supabase, profile, source));
  }

  return jsonResponse({
    ok: true,
    source,
    profiles: results,
  });
});
