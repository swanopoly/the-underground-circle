import { corsHeaders, jsonResponse } from "../_shared/edge.ts";

type RankingRow = {
  date?: string;
  model_permaslug?: string;
  variant?: string;
  variant_permaslug?: string;
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  total_native_tokens_reasoning?: number;
  change?: number | null;
};

type CatalogModel = {
  id: string;
  canonical_slug?: string | null;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

type PopularModel = {
  id: string;
  label: string;
  provider: string;
  rank: number;
  tokens: number;
  tokenLabel: string;
  changeLabel?: string;
  description: string;
  contextWindow?: number;
};

const RETIRED_POPULAR_MODEL_IDS = new Set([
  "gpt-4o", "gpt-4o-mini", "gpt-4.1-nano", "o3-mini", "o4-mini",
  "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-pro-preview",
  "deepseek-chat", "deepseek-reasoner",
]);

function isAllowedPopularModelId(value: string): boolean {
  const parts = value.toLowerCase().replace(/^openrouter\//, "").split("/");
  const tail = (parts.at(-1) || "").replace(/:.*$/, "");
  if (!tail || RETIRED_POPULAR_MODEL_IDS.has(tail)) return false;
  return !parts.some((part) => part === "x-ai" || part === "xai" || part === "grok" || part.startsWith("grok-"));
}

const OPENROUTER_RANKINGS_URL = "https://openrouter.ai/rankings";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 10 * 60_000;

let cache: { expiresAt: number; body: unknown } | null = null;

function parseLimit(req: Request, body: unknown): number {
  const url = new URL(req.url);
  const raw = typeof body === "object" && body && "limit" in body
    ? (body as { limit?: unknown }).limit
    : url.searchParams.get("limit");
  const n = Number(raw);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

function extractFlightPayloads(html: string): string[] {
  const payloads: string[] = [];
  const re = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      if (Array.isArray(parsed) && typeof parsed[1] === "string") {
        payloads.push(parsed[1]);
      }
    } catch {
      // Flight chunks are best-effort page data, so one bad chunk should not
      // prevent later chunks from being parsed.
    }
  }
  return payloads;
}

function extractJsonArray(payload: string, key: string): string | null {
  const keyIndex = payload.indexOf(`"${key}":[`);
  if (keyIndex < 0) return null;
  const start = payload.indexOf("[", keyIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < payload.length; i += 1) {
    const ch = payload[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
    } else if (ch === "[") {
      depth += 1;
    } else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return payload.slice(start, i + 1);
    }
  }

  return null;
}

function parseRankingRows(html: string): RankingRow[] {
  for (const payload of extractFlightPayloads(html)) {
    if (!payload.includes("\"rankingData\"")) continue;
    const arrayText = extractJsonArray(payload, "rankingData");
    if (!arrayText) continue;
    try {
      const parsed = JSON.parse(arrayText) as unknown;
      if (Array.isArray(parsed)) return parsed as RankingRow[];
    } catch {
      continue;
    }
  }
  return [];
}

function totalTokens(row: RankingRow): number {
  return (row.total_prompt_tokens || 0)
    + (row.total_completion_tokens || 0)
    + (row.total_native_tokens_reasoning || 0);
}

function formatCompactNumber(value: number): string {
  const units: Array<[number, string]> = [
    [1_000_000_000_000, "T"],
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  const unit = units.find(([size]) => value >= size);
  if (!unit) return String(Math.round(value));
  const [size, suffix] = unit;
  const scaled = value / size;
  const fixed = scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1) : scaled.toFixed(2);
  return `${fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")}${suffix}`;
}

function formatChange(value: number | null | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const pct = Math.round(Math.abs(value) * 100);
  if (pct === 0) return "flat";
  return `${value > 0 ? "+" : "-"}${pct}%`;
}

function formatPrice(raw?: string): string | null {
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  const perMillion = value * 1_000_000;
  return perMillion >= 1 ? `$${perMillion.toFixed(2)}/M` : `$${perMillion.toFixed(3)}/M`;
}

function cleanLabel(model: CatalogModel | null, fallbackSlug: string): string {
  const raw = model?.name || fallbackSlug.split("/").pop() || fallbackSlug;
  return raw.replace(/^[^:]+:\s*/, "");
}

function providerFromSlug(slug: string): string {
  return slug.split("/", 1)[0] || "openrouter";
}

function buildCatalogMaps(models: CatalogModel[]) {
  const byCanonical = new Map<string, CatalogModel[]>();
  const byId = new Map<string, CatalogModel>();

  for (const model of models) {
    byId.set(model.id, model);
    if (model.canonical_slug) {
      const list = byCanonical.get(model.canonical_slug) || [];
      list.push(model);
      byCanonical.set(model.canonical_slug, list);
    }
  }

  return { byCanonical, byId };
}

function resolveCatalogModel(
  row: RankingRow,
  maps: ReturnType<typeof buildCatalogMaps>,
): CatalogModel | null {
  const variantSlug = row.variant_permaslug || row.model_permaslug || "";
  const canonicalSlug = variantSlug.replace(/:free$/, "");
  const wantsFree = row.variant === "free" || variantSlug.endsWith(":free");

  const canonicalMatches = maps.byCanonical.get(canonicalSlug) || [];
  if (canonicalMatches.length > 0) {
    return canonicalMatches.find((model) => wantsFree ? model.id.endsWith(":free") : !model.id.endsWith(":free"))
      || canonicalMatches[0];
  }

  return maps.byId.get(variantSlug) || maps.byId.get(canonicalSlug) || null;
}

async function loadOpenRouterCatalog(): Promise<CatalogModel[]> {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: { "Accept": "application/json" },
  });
  if (!response.ok) return [];
  const json = await response.json() as { data?: CatalogModel[] };
  return Array.isArray(json.data) ? json.data : [];
}

async function buildResponse(limit: number) {
  const [rankingsResponse, catalog] = await Promise.all([
    fetch(OPENROUTER_RANKINGS_URL, {
      headers: {
        "Accept": "text/html",
        "User-Agent": "UndergroundCircle/1.0 OpenRouter rankings sync",
      },
    }),
    loadOpenRouterCatalog(),
  ]);

  if (!rankingsResponse.ok) {
    throw new Error(`OpenRouter rankings returned ${rankingsResponse.status}`);
  }

  const html = await rankingsResponse.text();
  const rows = parseRankingRows(html).filter((row) => totalTokens(row) > 0 && (row.variant_permaslug || row.model_permaslug));
  if (rows.length === 0) {
    throw new Error("OpenRouter rankings payload was empty");
  }

  const latestDate = rows
    .map((row) => row.date || "")
    .sort()
    .at(-1) || "";
  const currentRows = latestDate ? rows.filter((row) => row.date === latestDate) : rows;
  const maps = buildCatalogMaps(catalog);

  const candidates = currentRows
    .sort((a, b) => totalTokens(b) - totalTokens(a))
    .map((row) => {
      const slug = row.variant_permaslug || row.model_permaslug || "";
      const catalogModel = resolveCatalogModel(row, maps);
      const provider = catalogModel?.id ? providerFromSlug(catalogModel.id) : providerFromSlug(slug);
      const tokenCount = totalTokens(row);
      const tokenLabel = formatCompactNumber(tokenCount);
      const changeLabel = formatChange(row.change);
      const inPrice = formatPrice(catalogModel?.pricing?.prompt);
      const outPrice = formatPrice(catalogModel?.pricing?.completion);
      const priceLabel = inPrice && outPrice ? `${inPrice}->${outPrice}` : inPrice || outPrice || null;
      return {
        id: `openrouter/${catalogModel?.id || slug}`,
        label: cleanLabel(catalogModel, slug),
        provider,
        tokenCount,
        tokenLabel,
        changeLabel,
        priceLabel,
        contextWindow: catalogModel?.context_length,
      };
    })
    .filter((candidate) => isAllowedPopularModelId(candidate.id))
    .slice(0, limit);

  const models: PopularModel[] = candidates.map((candidate, index) => {
      const description = [
        `#${index + 1} OpenRouter weekly usage`,
        candidate.provider,
        `${candidate.tokenLabel} tokens`,
        candidate.changeLabel ? `${candidate.changeLabel} weekly` : null,
        candidate.priceLabel,
      ].filter(Boolean).join(" | ");

      return {
        id: candidate.id,
        label: candidate.label,
        provider: candidate.provider,
        rank: index + 1,
        tokens: candidate.tokenCount,
        tokenLabel: candidate.tokenLabel,
        changeLabel: candidate.changeLabel,
        description,
        contextWindow: candidate.contextWindow,
      };
    });

  return {
    source: "openrouter-rankings",
    rankingType: "week",
    date: latestDate || null,
    fetchedAt: new Date().toISOString(),
    models,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = parseLimit(req, body);
    const now = Date.now();

    if (cache && cache.expiresAt > now) {
      return jsonResponse(cache.body);
    }

    const responseBody = await buildResponse(limit);
    cache = { expiresAt: now + CACHE_TTL_MS, body: responseBody };
    return jsonResponse(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load OpenRouter rankings";
    return jsonResponse({ error: message, models: [] }, 502);
  }
});
