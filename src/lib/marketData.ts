// ─── Market Data Service ─────────────────────────────────────────────────────
// Fetches crypto data from CoinGecko (free, no key) and uses mock stock data
// TODO: Integrate a real stock API when available (most require API keys)

export interface MarketItem {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  type: 'crypto' | 'stock';
  image?: string;
}

export interface MarketData {
  crypto: MarketItem[];
  stocks: MarketItem[];
  gainers: MarketItem[];
  losers: MarketItem[];
}

// ─── CoinGecko (free) ───────────────────────────────────────────────────────

async function fetchTopCrypto(): Promise<MarketItem[]> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h',
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    return data.map((c: any) => ({
      symbol: (c.symbol as string).toUpperCase(),
      name: c.name,
      price: c.current_price ?? 0,
      change24h: c.price_change_percentage_24h ?? 0,
      type: 'crypto' as const,
      image: c.image,
    }));
  } catch (e) {
    console.error('fetchTopCrypto failed:', e);
    return [];
  }
}

// ─── Stock mock data ────────────────────────────────────────────────────────
// TODO: Replace with real API (Yahoo Finance, Finnhub, etc.)

function generateMockStocks(): MarketItem[] {
  const stocks = [
    { symbol: 'AAPL', name: 'Apple Inc.', base: 178.50 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', base: 415.20 },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', base: 175.80 },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', base: 218.40 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', base: 875.30 },
    { symbol: 'META', name: 'Meta Platforms', base: 590.10 },
    { symbol: 'TSLA', name: 'Tesla Inc.', base: 175.60 },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway', base: 430.50 },
    { symbol: 'JPM', name: 'JPMorgan Chase', base: 220.70 },
    { symbol: 'V', name: 'Visa Inc.', base: 289.30 },
  ];
  // Add small daily variance seeded by date so it's stable within a day
  const day = new Date().getDate();
  return stocks.map((s, i) => {
    const seed = ((day * 31 + i * 7) % 100) / 100; // 0-1 deterministic
    const change = (seed - 0.45) * 6; // roughly -2.7% to +3.3%
    return {
      symbol: s.symbol,
      name: s.name,
      price: +(s.base * (1 + change / 100)).toFixed(2),
      change24h: +change.toFixed(2),
      type: 'stock' as const,
    };
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function fetchMarketData(): Promise<MarketData> {
  const [crypto, stocks] = await Promise.all([
    fetchTopCrypto(),
    Promise.resolve(generateMockStocks()),
  ]);

  const all = [...crypto, ...stocks];
  const sorted = [...all].sort((a, b) => b.change24h - a.change24h);

  return {
    crypto,
    stocks,
    gainers: sorted.slice(0, 5),
    losers: sorted.slice(-5).reverse(),
  };
}
