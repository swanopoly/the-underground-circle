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
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';

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

// ─── X/Twitter Trends (via Gemini with Google Search grounding) ─
// Now asks for 12 trends with more variety

async function fetchXTrending(): Promise<TrendingItem[]> {
  if (!GEMINI_API_KEY) return [];

  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const hourStr = now.getHours().toString().padStart(2, '0');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `It is ${dateStr} ${hourStr}:00 UTC. What are the top 12 trending topics on X/Twitter RIGHT NOW?

Include a mix of:
- Tech/AI trending topics
- General viral topics and memes
- Breaking news people are discussing
- Hot takes and debates

For each topic, provide the thought bubble text AND a relevant X/Twitter post URL or search URL.

Return ONLY a JSON array of objects. Each has "text" (max 100 chars, agent thought style) and "url" (a specific viral tweet URL like https://x.com/username/status/123, or search URL like https://x.com/search?q=topic).
Example: [{"text": "X is buzzing about GPT-5 rumors. Timeline is on fire.", "url": "https://x.com/search?q=GPT-5"}]`
            }]
          }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1200,
          },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed
        .filter((s: any) => (typeof s === 'string' && s.length > 10) || (s?.text && s.text.length > 10))
        .map((s: any) => typeof s === 'string' ? { text: s } : { text: s.text, url: s.url })
        .slice(0, 12);
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Techmeme (via Gemini with Google Search grounding) ─────
// Real Techmeme headlines, not curated static lists

async function fetchTechmeme(): Promise<TrendingItem[]> {
  if (!GEMINI_API_KEY) return [];

  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `What are the top 10 headlines on Techmeme.com right now (${dateStr})?

Search techmeme.com for today's actual top stories. Include the most important tech industry news, deals, product launches, and controversies.

For each story, provide a thought bubble text AND the source article URL.

Return ONLY a JSON array of objects. Each object has "text" (headline, max 120 chars, prefixed with "Techmeme:") and "url" (the original article URL, NOT techmeme.com).
Example: [{"text": "Techmeme: OpenAI reportedly in talks to acquire Windsurf for $3B.", "url": "https://www.theinformation.com/articles/..."}]`
            }]
          }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 1200,
          },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed
        .filter((s: any) => (typeof s === 'string' && s.length > 10) || (s?.text && s.text.length > 10))
        .map((s: any) => typeof s === 'string' ? { text: s } : { text: s.text, url: s.url })
        .slice(0, 10);
    }
    return [];
  } catch {
    return [];
  }
}

// ─── Perplexity Trending / AI News (via Gemini grounding) ───
// Covers what's trending on Perplexity, AI research, and emerging tech

async function fetchPerplexityTrending(): Promise<TrendingItem[]> {
  if (!GEMINI_API_KEY) return [];

  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const hourStr = now.getHours().toString().padStart(2, '0');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `It is ${dateStr} ${hourStr}:00 UTC. What are the biggest AI and technology stories being discussed right now?

Search for:
1. Perplexity AI trending searches and popular topics
2. Latest AI research papers and breakthroughs (arxiv, etc)
3. Major tech product launches or updates from today
4. Developer tool releases and updates
5. Startup funding news and acquisitions

Give me 10 items. For each, provide the thought bubble text AND a source URL (article, paper, or product page).

Return ONLY a JSON array of objects. Each has "text" (max 120 chars, agent thought style) and "url" (source article/paper URL).
Example: [{"text": "AI news: New paper shows 10x speedup for transformer inference.", "url": "https://arxiv.org/abs/..."}]`
            }]
          }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 1200,
          },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed
        .filter((s: any) => (typeof s === 'string' && s.length > 10) || (s?.text && s.text.length > 10))
        .map((s: any) => typeof s === 'string' ? { text: s } : { text: s.text, url: s.url })
        .slice(0, 10);
    }
    return [];
  } catch {
    return [];
  }
}
