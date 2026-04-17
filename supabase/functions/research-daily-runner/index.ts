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

  let body: { profiles?: string[]; source?: string; action?: string; documentId?: string; reviewStatus?: string } = {};
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
      .select("metadata")
      .eq("id", documentId)
      .maybeSingle();

    if (fetchError) {
      return errResponse(500, "fetch_failed", fetchError.message);
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
