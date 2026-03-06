// Trending Content — fetches real HN stories + X/Twitter trends via Gemini
// Provides a synchronous cache for use in generateThoughtBubble()
import { storage } from './storage';

// ─── Types ─────────────────────────────────────────────────

export interface TrendingData {
  hn: string[];           // Formatted HN headlines as thought strings
  xTrending: string[];    // X/Twitter trending topics as thought strings
  fetchedAt: number;      // Unix timestamp ms
}

const STORAGE_KEY = 'uc_trending_content';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';

// Module-level cache — synchronous reads
let cachedData: TrendingData = { hn: [], xTrending: [], fetchedAt: 0 };
let loadPromise: Promise<void> | null = null;

// ─── Synchronous accessor (called by agentMessaging.ts) ────

export function getCachedTrending(): TrendingData {
  return cachedData;
}

// ─── Async loader (called once from OfficeTab mount) ───────

export async function loadTrendingContent(): Promise<void> {
  // Deduplicate concurrent calls
  if (loadPromise) return loadPromise;

  loadPromise = _doLoad();
  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function _doLoad(): Promise<void> {
  // 1. Restore from storage first (instant)
  try {
    const stored = await storage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: TrendingData = JSON.parse(stored);
      cachedData = parsed;

      // Within TTL — skip fetch
      if (Date.now() - parsed.fetchedAt < TTL_MS) {
        return;
      }
    }
  } catch {
    // Storage read failed, continue to fetch
  }

  // 2. Fetch fresh data in parallel
  const [hn, xTrending] = await Promise.allSettled([
    fetchHackerNews(),
    fetchXTrending(),
  ]);

  const newData: TrendingData = {
    hn: hn.status === 'fulfilled' ? hn.value : cachedData.hn,
    xTrending: xTrending.status === 'fulfilled' ? xTrending.value : cachedData.xTrending,
    fetchedAt: Date.now(),
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

async function fetchHackerNews(): Promise<string[]> {
  try {
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    if (!res.ok) throw new Error(`HN ${res.status}`);
    const ids: number[] = await res.json();

    const top10 = ids.slice(0, 10);
    const stories = await Promise.all(
      top10.map(async (id) => {
        try {
          const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
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
        return `HN: ${s.title}${score}`;
      })
      .slice(0, 8);
  } catch {
    return [];
  }
}

// ─── X/Twitter Trends (via Gemini with Google Search grounding) ─

async function fetchXTrending(): Promise<string[]> {
  if (!GEMINI_API_KEY) return [];

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `What are the top 8 trending topics on X/Twitter and tech news right now?

Format each as a single short sentence (max 80 chars) that an AI agent would say as a thought bubble.
Examples of the style:
- "X is buzzing about GPT-5 rumors. Timeline is on fire."
- "Trending on X: React 20 just dropped. Devs are hyped."
- "X hot take: Apple Vision Pro sales disappointing."

Return ONLY a JSON array of strings, no other text. Example: ["line1", "line2", ...]`
            }]
          }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 500,
          },
        }),
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON array (handle markdown code blocks)
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      return parsed
        .filter((s: any) => typeof s === 'string' && s.length > 10 && s.length < 120)
        .slice(0, 8);
    }
    return [];
  } catch {
    return [];
  }
}
