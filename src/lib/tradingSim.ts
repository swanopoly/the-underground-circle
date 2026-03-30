export type BacktestStrategyKey = 'trend_follow' | 'mean_revert' | 'breakout';

export interface BacktestStrategyDefinition {
  key: BacktestStrategyKey;
  label: string;
  description: string;
}

export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notionalUsd: number;
  pnlUsd: number;
  pnlPct: number;
  exitReason: string;
}

export interface BacktestEquityPoint {
  index: number;
  time: string;
  equityUsd: number;
}

export interface BacktestSimulationConfig {
  strategy: BacktestStrategyKey;
  tokenSymbol: string;
  tokenMint: string;
  prices: number[];
  timestamps: string[];
  initialCapitalUsd: number;
  feeBps: number;
  slippageBps: number;
  stopLossPct?: number;
  takeProfitPct?: number;
  trailingStopPct?: number;
}

export interface BacktestSimulationResult {
  strategy: BacktestStrategyKey;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  finalEquityUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  wins: number;
  losses: number;
  winRatePct: number;
}

export const BACKTEST_STRATEGIES: BacktestStrategyDefinition[] = [
  {
    key: 'trend_follow',
    label: 'Trend Rider',
    description: 'Buys momentum breakouts and exits on trend failure or protection levels.',
  },
  {
    key: 'mean_revert',
    label: 'Mean Reverter',
    description: 'Buys oversold pullbacks and exits on recovery back toward the average.',
  },
  {
    key: 'breakout',
    label: 'Breakout Scout',
    description: 'Trades fresh range breaks with protection against failed breakouts.',
  },
];

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampPrice(price: number): number {
  return Number.isFinite(price) && price > 0 ? price : 0.0000001;
}

function maxDrawdownPct(equityCurve: BacktestEquityPoint[]): number {
  let peak = 0;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equityUsd);
    if (peak <= 0) continue;
    const drawdown = ((peak - point.equityUsd) / peak) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  return maxDrawdown;
}

function shouldEnterStrategy(strategy: BacktestStrategyKey, prices: number[], index: number): boolean {
  const current = prices[index];
  const fast = average(prices.slice(Math.max(0, index - 2), index + 1));
  const slow = average(prices.slice(Math.max(0, index - 7), index + 1));
  const previousHigh = Math.max(...prices.slice(Math.max(0, index - 5), index));
  const previousLow = Math.min(...prices.slice(Math.max(0, index - 5), index));
  const momentumPct = ((current / clampPrice(prices[Math.max(0, index - 3)])) - 1) * 100;

  switch (strategy) {
    case 'trend_follow':
      return current > previousHigh && fast > slow && momentumPct > 1.2;
    case 'mean_revert':
      return current < slow * 0.975 && current <= previousLow * 1.01;
    case 'breakout':
      return current >= previousHigh * 1.004 && momentumPct > 0.8;
    default:
      return false;
  }
}

function shouldExitStrategy(strategy: BacktestStrategyKey, prices: number[], index: number, entryPrice: number): string | null {
  const current = prices[index];
  const fast = average(prices.slice(Math.max(0, index - 2), index + 1));
  const slow = average(prices.slice(Math.max(0, index - 7), index + 1));

  switch (strategy) {
    case 'trend_follow':
      return fast < slow ? 'trend_reversal' : null;
    case 'mean_revert':
      return current >= slow || current >= entryPrice * 1.025 ? 'mean_reversion_complete' : null;
    case 'breakout':
      return current < fast || current < entryPrice * 0.99 ? 'failed_breakout' : null;
    default:
      return null;
  }
}

export function runSnapshotBacktest(config: BacktestSimulationConfig): BacktestSimulationResult {
  const prices = config.prices.map(clampPrice);
  const timestamps = config.timestamps;
  let cashUsd = Math.max(0, config.initialCapitalUsd);
  let quantity = 0;
  let entryFillPrice = 0;
  let entryNotionalUsd = 0;
  let entryIndex = -1;
  let highestSinceEntry = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  const feeRate = Math.max(0, config.feeBps) / 10000;
  const slippageRate = Math.max(0, config.slippageBps) / 10000;

  for (let index = 1; index < prices.length; index += 1) {
    const currentPrice = prices[index];

    if (quantity <= 0 && shouldEnterStrategy(config.strategy, prices, index)) {
      const deployableCash = cashUsd * 0.95;
      if (deployableCash > 25) {
        const fillPrice = currentPrice * (1 + slippageRate);
        const entryFeeUsd = deployableCash * feeRate;
        const totalCostUsd = deployableCash + entryFeeUsd;
        quantity = deployableCash / fillPrice;
        cashUsd -= totalCostUsd;
        entryFillPrice = fillPrice;
        entryNotionalUsd = totalCostUsd;
        entryIndex = index;
        highestSinceEntry = fillPrice;
      }
    } else if (quantity > 0) {
      highestSinceEntry = Math.max(highestSinceEntry, currentPrice);
      const stopLossHit = config.stopLossPct && currentPrice <= entryFillPrice * (1 - (config.stopLossPct / 100));
      const takeProfitHit = config.takeProfitPct && currentPrice >= entryFillPrice * (1 + (config.takeProfitPct / 100));
      const trailingStopHit = config.trailingStopPct && currentPrice <= highestSinceEntry * (1 - (config.trailingStopPct / 100));
      const strategyExitReason = shouldExitStrategy(config.strategy, prices, index, entryFillPrice);
      const exitReason = stopLossHit
        ? 'stop_loss'
        : takeProfitHit
          ? 'take_profit'
          : trailingStopHit
            ? 'trailing_stop'
            : strategyExitReason;

      if (exitReason) {
        const exitFillPrice = currentPrice * (1 - slippageRate);
        const grossValueUsd = quantity * exitFillPrice;
        const exitFeeUsd = grossValueUsd * feeRate;
        const realizedUsd = grossValueUsd - exitFeeUsd;
        const pnlUsd = realizedUsd - entryNotionalUsd;
        cashUsd += realizedUsd;
        trades.push({
          entryIndex,
          exitIndex: index,
          entryTime: timestamps[entryIndex] || new Date().toISOString(),
          exitTime: timestamps[index] || new Date().toISOString(),
          entryPrice: entryFillPrice,
          exitPrice: exitFillPrice,
          quantity,
          notionalUsd: entryNotionalUsd,
          pnlUsd,
          pnlPct: entryNotionalUsd > 0 ? (pnlUsd / entryNotionalUsd) * 100 : 0,
          exitReason,
        });
        quantity = 0;
        entryFillPrice = 0;
        entryNotionalUsd = 0;
        entryIndex = -1;
        highestSinceEntry = 0;
      }
    }

    const markToMarket = quantity > 0 ? quantity * currentPrice : 0;
    equityCurve.push({
      index,
      time: timestamps[index] || new Date().toISOString(),
      equityUsd: cashUsd + markToMarket,
    });
  }

  if (quantity > 0) {
    const lastIndex = prices.length - 1;
    const exitFillPrice = prices[lastIndex] * (1 - slippageRate);
    const grossValueUsd = quantity * exitFillPrice;
    const exitFeeUsd = grossValueUsd * feeRate;
    const realizedUsd = grossValueUsd - exitFeeUsd;
    const pnlUsd = realizedUsd - entryNotionalUsd;
    cashUsd += realizedUsd;
    trades.push({
      entryIndex,
      exitIndex: lastIndex,
      entryTime: timestamps[entryIndex] || new Date().toISOString(),
      exitTime: timestamps[lastIndex] || new Date().toISOString(),
      entryPrice: entryFillPrice,
      exitPrice: exitFillPrice,
      quantity,
      notionalUsd: entryNotionalUsd,
      pnlUsd,
      pnlPct: entryNotionalUsd > 0 ? (pnlUsd / entryNotionalUsd) * 100 : 0,
      exitReason: 'session_end',
    });
    equityCurve.push({
      index: lastIndex,
      time: timestamps[lastIndex] || new Date().toISOString(),
      equityUsd: cashUsd,
    });
  }

  const finalEquityUsd = equityCurve[equityCurve.length - 1]?.equityUsd ?? cashUsd;
  const netPnlUsd = finalEquityUsd - config.initialCapitalUsd;
  const netPnlPct = config.initialCapitalUsd > 0 ? (netPnlUsd / config.initialCapitalUsd) * 100 : 0;
  const wins = trades.filter(trade => trade.pnlUsd > 0).length;
  const losses = trades.filter(trade => trade.pnlUsd <= 0).length;
  const buyHoldReturnPct = prices[0] > 0 ? ((prices[prices.length - 1] / prices[0]) - 1) * 100 : 0;

  return {
    strategy: config.strategy,
    trades,
    equityCurve,
    finalEquityUsd,
    netPnlUsd,
    netPnlPct,
    buyHoldReturnPct,
    maxDrawdownPct: maxDrawdownPct(equityCurve),
    wins,
    losses,
    winRatePct: trades.length > 0 ? (wins / trades.length) * 100 : 0,
  };
}
