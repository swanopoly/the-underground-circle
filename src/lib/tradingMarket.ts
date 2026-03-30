import { SOL_MINT, SOLANA_TOKEN_REGISTRY, USDC_MINT } from './heliusTrading';

export interface TokenMarketSnapshot {
  mint: string;
  symbol: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume24h: number;
  liquidityUsd: number;
  marketCap: number;
  fdv: number;
  buys24h: number;
  sells24h: number;
  pairCreatedAt?: number;
  dexId?: string;
  pairUrl?: string;
  activeBoosts: number;
  websites: string[];
  socials: string[];
}

function getTokenMetaByMint(mint: string): { symbol: string; decimals: number } {
  const entry = Object.entries(SOLANA_TOKEN_REGISTRY).find(([, token]) => token.mint === mint);
  if (entry) {
    return { symbol: entry[0], decimals: entry[1].decimals };
  }
  return {
    symbol: mint === SOL_MINT ? 'SOL' : mint === USDC_MINT ? 'USDC' : mint.slice(0, 6),
    decimals: mint === SOL_MINT ? 9 : 6,
  };
}

function getPairTokenPrice(pair: any, mint: string): number {
  const baseAddress = pair?.baseToken?.address;
  const priceUsd = parseFloat(pair?.priceUsd || '0') || 0;
  if (baseAddress === mint) return priceUsd;
  const priceNative = parseFloat(pair?.priceNative || '0') || 0;
  return priceNative > 0 && priceUsd > 0 ? priceUsd / priceNative : priceUsd;
}

function deriveAnchorPrice(currentPrice: number, changePct: number): number {
  const divisor = 1 + (changePct / 100);
  if (!Number.isFinite(divisor) || divisor === 0) return currentPrice;
  const derived = currentPrice / divisor;
  return Number.isFinite(derived) && derived > 0 ? derived : currentPrice;
}

export function parsePositiveNumber(value: string): number | undefined {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0';
  const prefix = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${prefix}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}$${(abs / 1_000).toFixed(1)}K`;
  return `${prefix}$${abs.toFixed(2)}`;
}

export function formatPct(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function buildSnapshotTimestamps(points = 31, lookbackHours = 24, endAtMs = Date.now()): string[] {
  const safePoints = Math.max(2, points);
  const startMs = endAtMs - (lookbackHours * 3600000);
  const stepMs = (endAtMs - startMs) / (safePoints - 1);
  return Array.from({ length: safePoints }, (_, index) => new Date(startMs + (stepMs * index)).toISOString());
}

export function buildPriceSeriesFromSnapshot(snapshot: TokenMarketSnapshot, points = 31): number[] {
  const safePoints = Math.max(8, points);
  const currentPrice = Math.max(snapshot.priceUsd, 0.0000001);
  const anchors = [
    { index: 0, price: deriveAnchorPrice(currentPrice, snapshot.priceChange24h) },
    { index: Math.max(1, Math.round((safePoints - 1) * 0.75)), price: deriveAnchorPrice(currentPrice, snapshot.priceChange6h) },
    { index: Math.max(2, Math.round((safePoints - 1) * 0.9583)), price: deriveAnchorPrice(currentPrice, snapshot.priceChange1h) },
    { index: Math.max(3, safePoints - 2), price: deriveAnchorPrice(currentPrice, snapshot.priceChange5m) },
    { index: safePoints - 1, price: currentPrice },
  ];

  const orderedAnchors = anchors
    .map(anchor => ({ ...anchor, index: Math.min(safePoints - 1, Math.max(0, anchor.index)) }))
    .sort((left, right) => left.index - right.index)
    .filter((anchor, index, list) => index === 0 || anchor.index !== list[index - 1].index);

  const prices = Array.from({ length: safePoints }, () => currentPrice);
  for (let segment = 0; segment < orderedAnchors.length - 1; segment += 1) {
    const start = orderedAnchors[segment];
    const end = orderedAnchors[segment + 1];
    const span = Math.max(1, end.index - start.index);
    for (let index = start.index; index <= end.index; index += 1) {
      const progress = (index - start.index) / span;
      const basePrice = start.price + ((end.price - start.price) * progress);
      prices[index] = Math.max(basePrice, 0.0000001);
    }
  }

  const volatilitySeed = Math.max(
    Math.abs(snapshot.priceChange5m),
    Math.abs(snapshot.priceChange1h),
    Math.abs(snapshot.priceChange6h),
    Math.abs(snapshot.priceChange24h)
  );
  const liquidityFactor = snapshot.liquidityUsd > 0
    ? Math.min(1, snapshot.volume24h / Math.max(snapshot.liquidityUsd, 1))
    : 0;
  const orderFlowBias = snapshot.buys24h + snapshot.sells24h > 0
    ? (snapshot.buys24h - snapshot.sells24h) / (snapshot.buys24h + snapshot.sells24h)
    : 0;
  const waveAmplitudePct = Math.min(4, (volatilitySeed * 0.08) + (liquidityFactor * 1.5));

  return prices.map((price, index) => {
    if (index === 0 || index === prices.length - 1) return price;
    const wave = Math.sin((index / (prices.length - 1)) * Math.PI * 3) * waveAmplitudePct;
    const drift = orderFlowBias * (index / (prices.length - 1)) * 1.5;
    return Math.max(price * (1 + ((wave + drift) / 100)), 0.0000001);
  });
}

export async function fetchTokenMarketSnapshot(mint: string): Promise<TokenMarketSnapshot | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    if (!response.ok) return null;
    const pairs = await response.json();
    if (!Array.isArray(pairs) || pairs.length === 0) return null;

    const bestPair = [...pairs].sort((left, right) => {
      const liquidityDiff = (right?.liquidity?.usd || 0) - (left?.liquidity?.usd || 0);
      if (liquidityDiff !== 0) return liquidityDiff;
      return (right?.volume?.h24 || 0) - (left?.volume?.h24 || 0);
    })[0];

    const meta = getTokenMetaByMint(mint);
    return {
      mint,
      symbol: meta.symbol,
      priceUsd: getPairTokenPrice(bestPair, mint),
      priceChange5m: Number(bestPair?.priceChange?.m5 || 0),
      priceChange1h: Number(bestPair?.priceChange?.h1 || 0),
      priceChange6h: Number(bestPair?.priceChange?.h6 || 0),
      priceChange24h: Number(bestPair?.priceChange?.h24 || 0),
      volume24h: Number(bestPair?.volume?.h24 || 0),
      liquidityUsd: Number(bestPair?.liquidity?.usd || 0),
      marketCap: Number(bestPair?.marketCap || 0),
      fdv: Number(bestPair?.fdv || 0),
      buys24h: Number(bestPair?.txns?.h24?.buys || 0),
      sells24h: Number(bestPair?.txns?.h24?.sells || 0),
      pairCreatedAt: bestPair?.pairCreatedAt,
      dexId: bestPair?.dexId,
      pairUrl: bestPair?.url,
      activeBoosts: Number(bestPair?.boosts?.active || 0),
      websites: Array.isArray(bestPair?.info?.websites)
        ? bestPair.info.websites.map((site: any) => site?.url).filter(Boolean)
        : [],
      socials: Array.isArray(bestPair?.info?.socials)
        ? bestPair.info.socials.map((social: any) => social?.handle || social?.platform).filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
}
