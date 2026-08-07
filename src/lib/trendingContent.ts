// Trending Content — fetches real data from HN, X/Twitter, Techmeme, Perplexity
// Refreshes every hour with automatic background polling
// Provides a synchronous cache for use in generateThoughtBubble()
import { storage } from './storage';

// ─── Types ─────────────────────────────────────────────────

export interface TrendingItem {
  text: string;
  url?: string;
}

export interface TrendingData {
  hn: string[];           // Formatted HN headlines as thought strings
  xTrending: string[];    // X/Twitter trending topics as thought strings
  techmeme: string[];     // Real Techmeme headlines
  perplexity: string[];   // Perplexity trending / AI news
  fetchedAt: number;      // Unix timestamp ms
  // Rich items with URLs for "Read more" links
  hnItems: TrendingItem[];
  xItems: TrendingItem[];
  techmemeItems: TrendingItem[];
  perplexityItems: TrendingItem[];
}

const STORAGE_KEY = 'uc_trending_content';
const TTL_MS = 60 * 60 * 1000; // 1 hour — fresh content every hour
let providerWarningLogged = false;

// Module-level cache — synchronous reads
let cachedData: TrendingData = { hn: [], xTrending: [], techmeme: [], perplexity: [], fetchedAt: 0, hnItems: [], xItems: [], techmemeItems: [], perplexityItems: [] };
let loadPromise: Promise<void> | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// ─── Synchronous accessor (called by agentMessaging.ts) ────

export function getCachedTrending(): TrendingData {
  return cachedData;
}

// ─── Async loader (called from OfficeTab mount) ────────────
// Now also starts a background refresh interval

export async function loadTrendingContent(): Promise<void> {
  // Deduplicate concurrent calls
  if (loadPromise) return loadPromise;

  loadPromise = _doLoad();
  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }

  // Start background refresh every hour (if not already running)
  if (!refreshInterval) {
    refreshInterval = setInterval(() => {
      // Force refresh by clearing the in-memory timestamp
      cachedData = { ...cachedData, fetchedAt: 0 };
      loadTrendingContent().catch(() => {});
    }, TTL_MS);
  }
}

// Stop the background refresh (called on unmount if needed)
export function stopTrendingRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

async function _doLoad(): Promise<void> {
  // 1. Restore from storage first (instant)
  try {
    const stored = await storage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: TrendingData = JSON.parse(stored);
      // Migrate old format missing new fields
      cachedData = {
        hn: parsed.hn || [],
        xTrending: parsed.xTrending || [],
        techmeme: parsed.techmeme || [],
        perplexity: parsed.perplexity || [],
        fetchedAt: parsed.fetchedAt || 0,
        hnItems: parsed.hnItems || [],
        xItems: parsed.xItems || [],
        techmemeItems: parsed.techmemeItems || [],
        perplexityItems: parsed.perplexityItems || [],
      };

      // Within TTL — skip fetch
      if (Date.now() - cachedData.fetchedAt < TTL_MS) {
        return;
      }
    }
  } catch {
    // Storage read failed, continue to fetch
  }

  // 2. Fetch all sources in parallel
  const [hn, xTrending, techmeme, perplexity] = await Promise.allSettled([
    fetchHackerNews(),
    fetchXTrending(),
    fetchTechmeme(),
    fetchPerplexityTrending(),
  ]);

  // Extract rich items from HN (which returns TrendingItem[])
  const hnResult = hn.status === 'fulfilled' ? hn.value : [];
  const xResult = xTrending.status === 'fulfilled' ? xTrending.value : [];
  const tmResult = techmeme.status === 'fulfilled' ? techmeme.value : [];
  const pxResult = perplexity.status === 'fulfilled' ? perplexity.value : [];

  const newData: TrendingData = {
    hn: hnResult.length > 0 ? hnResult.map((i: any) => typeof i === 'string' ? i : i.text) : cachedData.hn,
    xTrending: xResult.length > 0 ? xResult.map((i: any) => typeof i === 'string' ? i : i.text) : cachedData.xTrending,
    techmeme: tmResult.length > 0 ? tmResult.map((i: any) => typeof i === 'string' ? i : i.text) : cachedData.techmeme,
    perplexity: pxResult.length > 0 ? pxResult.map((i: any) => typeof i === 'string' ? i : i.text) : cachedData.perplexity,
    fetchedAt: Date.now(),
    hnItems: hnResult.length > 0 ? hnResult.filter((i: any) => typeof i !== 'string') : cachedData.hnItems,
    xItems: xResult.length > 0 ? xResult.filter((i: any) => typeof i !== 'string') : cachedData.xItems,
    techmemeItems: tmResult.length > 0 ? tmResult.filter((i: any) => typeof i !== 'string') : cachedData.techmemeItems,
    perplexityItems: pxResult.length > 0 ? pxResult.filter((i: any) => typeof i !== 'string') : cachedData.perplexityItems,
  };

  cachedData = newData;

  // 3. Persist (fire-and-forget)
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(newData));
  } catch {
    // Silent fail
  }
}

// ─── Hacker News (free, no auth, CORS-friendly) ───────────
// Fetch top 20 stories (was 10 — bigger pool = less repetition)

async function fetchHackerNews(): Promise<TrendingItem[]> {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HN ${res.status}`);
    const ids: number[] = await res.json();

    // Fetch top 20 for a bigger pool
    const top = ids.slice(0, 20);
    const stories = await Promise.all(
      top.map(async (id) => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!r.ok) return null;
          return await r.json();
        } catch {
          return null;
        }
      })
    );

    return stories
      .filter((s: any) => s?.title)
      .map((s: any) => {
        const score = s.score > 100 ? ` (${s.score} pts)` : '';
        const comments = s.descendants > 50 ? ` • ${s.descendants} comments` : '';
        return {
          text: `HN: ${s.title}${score}${comments}`,
          url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
        };
      })
      .slice(0, 15);
  } catch {
    return [];
  }
}

// ─── Server-side web-search enrichment ─────────────────────

function isSafeTrendUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseTrendItems(text: string, limit: number): TrendingItem[] {
  try {
    const cleaned = text.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): TrendingItem[] => {
      const itemText = typeof item === 'string'
        ? item.trim()
        : typeof item?.text === 'string' ? item.text.trim() : '';
      if (itemText.length <= 10) return [];
      const url = typeof item === 'object' && isSafeTrendUrl(item?.url) ? item.url : undefined;
      return [{ text: itemText.slice(0, 160), ...(url ? { url } : {}) }];
    }).slice(0, limit);
  } catch {
    return [];
  }
}

async function fetchServerSideTrendItems(prompt: string, limit: number): Promise<TrendingItem[]> {
  try {
    // Dynamic import keeps the background Office feed from eagerly loading
    // the Marketplace catalog. The request still crosses authenticated
    // llm-proxy; the user's OpenRouter key never reaches this browser module.
    const { webSearchViaOpenRouter } = await import('./llmProviders');
    const result = await webSearchViaOpenRouter({ query: prompt, maxTokens: 1200 });
    return parseTrendItems(result.response, limit);
  } catch {
    if (!providerWarningLogged) {
      console.warn('[TrendingContent] Live trend enrichment is unavailable. Connect or verify an OpenRouter key in Marketplace; Hacker News remains available.');
      providerWarningLogged = true;
    }
    return [];
  }
}

// ─── X/Twitter Trends (server-side web search) ─────────────

async function fetchXTrending(): Promise<TrendingItem[]> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hourStr = now.getUTCHours().toString().padStart(2, '0');
  return fetchServerSideTrendItems(`It is ${dateStr} ${hourStr}:00 UTC. Find the top 12 trending topics on X/Twitter right now.

Include a mix of tech/AI, general viral topics, breaking news, memes, and active debates. For each topic, provide a concise thought-bubble text and a relevant X/Twitter post or search URL.

Return ONLY a JSON array of objects with "text" (max 100 chars) and "url" (an https://x.com URL).`, 12);
}

// ─── Techmeme (server-side web search) ─────────────────────

async function fetchTechmeme(): Promise<TrendingItem[]> {
  const dateStr = new Date().toISOString().split('T')[0];
  return fetchServerSideTrendItems(`Find the top 10 headlines on Techmeme.com right now (${dateStr}). Include today's actual tech-industry news, deals, product launches, and controversies.

For each story, provide a concise headline prefixed with "Techmeme:" and the original source article URL.

Return ONLY a JSON array of objects with "text" (max 120 chars) and "url" (the original https article URL).`, 10);
}

// ─── Perplexity Trending / AI News (server-side web search) ─

async function fetchPerplexityTrending(): Promise<TrendingItem[]> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hourStr = now.getUTCHours().toString().padStart(2, '0');
  return fetchServerSideTrendItems(`It is ${dateStr} ${hourStr}:00 UTC. Find the 10 biggest current AI and technology stories, including Perplexity topics, AI research, product launches, developer tools, funding, and acquisitions.

For each item, provide a concise thought-bubble text and the primary source URL.

Return ONLY a JSON array of objects with "text" (max 120 chars) and "url" (an https source URL).`, 10);
}
